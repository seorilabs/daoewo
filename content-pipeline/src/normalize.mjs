import { createHash } from "node:crypto";

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOptional(value) {
  const normalized = normalizeText(value);
  return normalized.length === 0 ? undefined : normalized;
}

function uniqueNormalized(values) {
  const seen = new Set();
  const result = [];
  for (const value of values ?? []) {
    const normalized = normalizeText(value);
    const key = normalized.toLocaleLowerCase("ko-KR");
    if (normalized.length > 0 && !seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }
  return result;
}

function stableCardId(deckId, front, back) {
  const digest = createHash("sha256").update(`${deckId}\u0000${front}\u0000${back}`).digest("hex").slice(0, 16);
  return `${deckId}.${digest}`;
}

export function normalizeCards(deckId, rawCards) {
  return rawCards.map((rawCard, index) => {
    const front = normalizeText(rawCard.front);
    const back = normalizeText(rawCard.back);
    const normalized = {
      id: stableCardId(deckId, front, back),
      deckId,
      index,
      front,
      back,
      tags: uniqueNormalized(rawCard.tags),
      difficulty: Number.isInteger(rawCard.difficulty) ? rawCard.difficulty : 3,
      sourceRefs: uniqueNormalized(rawCard.sourceRefs),
    };

    for (const field of ["hint", "reading", "example", "exampleMeaning"]) {
      const value = normalizeOptional(rawCard[field]);
      if (value !== undefined) normalized[field] = value;
    }

    if (rawCard.media !== undefined) {
      normalized.media = {
        kind: rawCard.media.kind,
        uri: normalizeText(rawCard.media.uri),
        alt: normalizeText(rawCard.media.alt),
        licenseRef: normalizeText(rawCard.media.licenseRef),
      };
    }

    return normalized;
  });
}

function canonical(value) {
  return normalizeText(value).toLocaleLowerCase("ko-KR").replace(/[\p{P}\p{S}]/gu, "");
}

export function dedupeCards(cards) {
  const exact = new Map();
  const frontIndex = new Map();
  const kept = [];
  const removed = [];
  const conflicts = [];

  for (const card of cards) {
    const frontKey = canonical(card.front);
    const exactKey = `${frontKey}\u0000${canonical(card.back)}`;

    if (exact.has(exactKey)) {
      removed.push({ duplicateId: card.id, keptId: exact.get(exactKey).id, reason: "same-front-and-back" });
      continue;
    }

    if (frontIndex.has(frontKey) && canonical(frontIndex.get(frontKey).back) !== canonical(card.back)) {
      conflicts.push({ leftId: frontIndex.get(frontKey).id, rightId: card.id, reason: "same-front-different-back" });
    }

    exact.set(exactKey, card);
    frontIndex.set(frontKey, frontIndex.get(frontKey) ?? card);
    kept.push(card);
  }

  const reindexed = kept.map((card, index) => ({ ...card, index }));
  return { cards: reindexed, removed, conflicts };
}
