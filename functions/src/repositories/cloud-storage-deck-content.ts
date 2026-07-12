import { BACKEND_CONFIG } from "../config.js";
import type { DeckMetadata, StudyCard } from "../domain/types.js";
import { BackendError, assertBackend } from "../errors.js";
import type { DeckContentRepository } from "./contracts.js";

interface BucketLike {
  file(path: string): {
    download(): Promise<[Buffer]>;
  };
}

interface ChunkPayload {
  cards: unknown[];
}

export class CloudStorageDeckContentRepository implements DeckContentRepository {
  private readonly cache = new Map<string, readonly StudyCard[]>();
  private readonly pending = new Map<string, Promise<readonly StudyCard[]>>();

  constructor(
    private readonly bucket: BucketLike,
    private readonly maxCacheEntries = BACKEND_CONFIG.chunkCacheEntries,
  ) {}

  async getCardsByIndexes(
    deck: Pick<DeckMetadata, "id" | "version" | "cardCount" | "chunkSize">,
    indexes: readonly number[],
  ): Promise<StudyCard[]> {
    const uniqueIndexes = [...new Set(indexes)].sort((a, b) => a - b);
    for (const index of uniqueIndexes) {
      assertBackend(
        Number.isSafeInteger(index) && index >= 0 && index < deck.cardCount,
        "invalid-argument",
        `Card index ${index} is outside deck ${deck.id}.`,
      );
    }

    const chunkSize = deck.chunkSize || BACKEND_CONFIG.chunkSize;
    const chunkIndexes = [...new Set(uniqueIndexes.map((index) => Math.floor(index / chunkSize)))];
    const chunks = await Promise.all(
      chunkIndexes.map(async (chunkIndex) => ({
        chunkIndex,
        cards: await this.loadChunk(deck.id, deck.version, chunkIndex, chunkSize),
      })),
    );
    const byIndex = new Map<number, StudyCard>();
    for (const chunk of chunks) {
      for (const card of chunk.cards) {
        byIndex.set(card.index, card);
      }
    }

    return uniqueIndexes.map((index) => {
      const card = byIndex.get(index);
      if (card === undefined) {
        throw new BackendError(
          "failed-precondition",
          `Published deck ${deck.id} is missing card index ${index}.`,
        );
      }
      return card;
    });
  }

  private async loadChunk(
    deckId: string,
    version: number,
    chunkIndex: number,
    chunkSize: number,
  ): Promise<readonly StudyCard[]> {
    const key = `${deckId}:v${version}:${chunkIndex}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }

    const inFlight = this.pending.get(key);
    if (inFlight !== undefined) {
      return inFlight;
    }

    const promise = this.downloadChunk(deckId, version, chunkIndex, chunkSize)
      .then((cards) => {
        this.cache.set(key, cards);
        while (this.cache.size > this.maxCacheEntries) {
          const oldestKey = this.cache.keys().next().value as string | undefined;
          if (oldestKey === undefined) break;
          this.cache.delete(oldestKey);
        }
        return cards;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }

  private async downloadChunk(
    deckId: string,
    version: number,
    chunkIndex: number,
    chunkSize: number,
  ): Promise<readonly StudyCard[]> {
    const path = `decks/${deckId}/v${version}/chunk-${chunkIndex}.json`;
    let raw: Buffer;
    try {
      [raw] = await this.bucket.file(path).download();
    } catch (error) {
      throw new BackendError("failed-precondition", `Deck content is unavailable: ${path}`, {
        cause: error instanceof Error ? error.message : "unknown",
      });
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(raw.toString("utf8"));
    } catch {
      throw new BackendError("failed-precondition", `Deck content is invalid JSON: ${path}`);
    }

    const payload: ChunkPayload = Array.isArray(decoded)
      ? { cards: decoded }
      : (decoded as ChunkPayload);
    assertBackend(
      payload !== null && Array.isArray(payload.cards),
      "failed-precondition",
      `Deck chunk must contain a cards array: ${path}`,
    );

    const firstIndex = chunkIndex * chunkSize;
    return Object.freeze(
      payload.cards.map((card, offset) => parseCard(card, firstIndex + offset, path)),
    );
  }
}

function parseCard(value: unknown, fallbackIndex: number, path: string): StudyCard {
  assertBackend(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "failed-precondition",
    `Deck chunk contains a non-object card: ${path}`,
  );
  const raw = value as Record<string, unknown>;
  const index = raw.index === undefined ? fallbackIndex : raw.index;
  assertBackend(
    typeof index === "number" && Number.isSafeInteger(index) && index >= 0,
    "failed-precondition",
    `Deck card index is invalid: ${path}`,
  );
  assertBackend(
    typeof raw.id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(raw.id),
    "failed-precondition",
    `Deck card id is invalid: ${path}`,
  );
  assertBackend(
    typeof raw.front === "string" && raw.front.length > 0 && raw.front.length <= 4_000,
    "failed-precondition",
    `Deck card front is invalid: ${path}`,
  );
  assertBackend(
    typeof raw.back === "string" && raw.back.length > 0 && raw.back.length <= 8_000,
    "failed-precondition",
    `Deck card back is invalid: ${path}`,
  );

  const card: StudyCard = {
    id: raw.id,
    index,
    front: raw.front,
    back: raw.back,
  };
  if (typeof raw.hint === "string") card.hint = raw.hint.slice(0, 4_000);
  if (typeof raw.example === "string") card.example = raw.example.slice(0, 8_000);
  if (Array.isArray(raw.tags)) {
    card.tags = raw.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 32);
  }
  return Object.freeze(card);
}
