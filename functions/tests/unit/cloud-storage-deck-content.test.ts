import { describe, expect, it } from "vitest";
import { CloudStorageDeckContentRepository } from "../../src/repositories/cloud-storage-deck-content.js";

describe("CloudStorageDeckContentRepository", () => {
  it("loads only calculated immutable chunks and reuses the memory cache", async () => {
    const downloads: string[] = [];
    const chunks: Record<string, unknown> = {
      "decks/deck-a/v3/chunk-0.json": {
        cards: Array.from({ length: 200 }, (_, index) => ({
          id: `card-${index}`,
          index,
          front: `front-${index}`,
          back: `back-${index}`,
        })),
      },
      "decks/deck-a/v3/chunk-1.json": {
        cards: Array.from({ length: 5 }, (_, offset) => ({
          id: `card-${200 + offset}`,
          index: 200 + offset,
          front: `front-${200 + offset}`,
          back: `back-${200 + offset}`,
        })),
      },
    };
    const bucket = {
      file: (path: string) => ({
        download: async (): Promise<[Buffer]> => {
          downloads.push(path);
          return [Buffer.from(JSON.stringify(chunks[path]))];
        },
      }),
    };
    const repository = new CloudStorageDeckContentRepository(bucket, 4);
    const deck = { id: "deck-a", version: 3, cardCount: 205, chunkSize: 200 };

    const first = await repository.getCardsByIndexes(deck, [0, 199, 200, 204]);
    const second = await repository.getCardsByIndexes(deck, [200, 0]);

    expect(first.map((card) => card.id)).toEqual([
      "card-0",
      "card-199",
      "card-200",
      "card-204",
    ]);
    expect(second.map((card) => card.id)).toEqual(["card-0", "card-200"]);
    expect(downloads).toEqual([
      "decks/deck-a/v3/chunk-0.json",
      "decks/deck-a/v3/chunk-1.json",
    ]);
  });

  it("rejects indexes outside published metadata", async () => {
    const repository = new CloudStorageDeckContentRepository({
      file: () => ({ download: async (): Promise<[Buffer]> => [Buffer.from("[]")] }),
    });

    await expect(
      repository.getCardsByIndexes(
        { id: "deck-a", version: 1, cardCount: 2, chunkSize: 200 },
        [2],
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });
});
