const DECK_STATUSES = new Set([
  "planned",
  "generated",
  "normalized",
  "deduplicated",
  "safety-qa-passed",
  "copyright-qa-passed",
  "factual-qa-passed",
  "awaiting-human-approval",
  "approved",
  "chunked",
  "published",
  "rejected",
  "archived",
]);

const APPROVED_STATUSES = new Set(["approved", "chunked", "published"]);
const BACKLOG_SOURCES = ["deck-request", "search-miss", "trend", "operator"];
const CARD_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,127}$/;
const DECK_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,79}$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;

export class ValidationError extends Error {
  constructor(scope, errors) {
    super(`${scope} 검증 실패:\n- ${errors.join("\n- ")}`);
    this.name = "ValidationError";
    this.errors = errors;
  }
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function nullableNonEmptyString(value) {
  return value === null || nonEmptyString(value);
}

function assertNoErrors(scope, errors) {
  if (errors.length > 0) {
    throw new ValidationError(scope, errors);
  }
}

export function validateCard(card) {
  const errors = [];
  const allowedKeys = new Set([
    "id",
    "deckId",
    "index",
    "front",
    "back",
    "hint",
    "reading",
    "example",
    "exampleMeaning",
    "media",
    "tags",
    "difficulty",
    "sourceRefs",
  ]);

  if (card === null || typeof card !== "object" || Array.isArray(card)) {
    return ["카드는 객체여야 한다."];
  }

  for (const key of Object.keys(card)) {
    if (!allowedKeys.has(key)) {
      errors.push(`허용하지 않는 필드: ${key}`);
    }
  }

  if (!CARD_ID_PATTERN.test(card.id ?? "")) errors.push("id 형식이 올바르지 않다.");
  if (!DECK_ID_PATTERN.test(card.deckId ?? "")) errors.push("deckId 형식이 올바르지 않다.");
  if (!Number.isInteger(card.index) || card.index < 0) errors.push("index는 0 이상의 정수여야 한다.");
  if (!nonEmptyString(card.front) || card.front.length > 500) errors.push("front는 1~500자 문자열이어야 한다.");
  if (!nonEmptyString(card.back) || card.back.length > 2000) errors.push("back은 1~2000자 문자열이어야 한다.");

  for (const [key, limit] of [
    ["hint", 500],
    ["reading", 300],
    ["example", 1000],
    ["exampleMeaning", 1000],
  ]) {
    if (key in card && (!nonEmptyString(card[key]) || card[key].length > limit)) {
      errors.push(`${key}는 비어 있지 않은 ${limit}자 이하 문자열이어야 한다.`);
    }
  }

  if (!Array.isArray(card.tags) || card.tags.length > 20 || card.tags.some((tag) => !nonEmptyString(tag))) {
    errors.push("tags는 20개 이하의 비어 있지 않은 문자열 배열이어야 한다.");
  } else if (new Set(card.tags).size !== card.tags.length) {
    errors.push("tags에 중복이 있다.");
  }

  if (!Number.isInteger(card.difficulty) || card.difficulty < 1 || card.difficulty > 5) {
    errors.push("difficulty는 1~5 정수여야 한다.");
  }

  if (
    !Array.isArray(card.sourceRefs) ||
    card.sourceRefs.length === 0 ||
    card.sourceRefs.some((sourceRef) => !nonEmptyString(sourceRef))
  ) {
    errors.push("sourceRefs는 하나 이상의 출처 ID를 포함해야 한다.");
  } else if (new Set(card.sourceRefs).size !== card.sourceRefs.length) {
    errors.push("sourceRefs에 중복이 있다.");
  }

  if (card.media !== undefined) {
    const mediaKeys = Object.keys(card.media ?? {});
    if (
      card.media === null ||
      typeof card.media !== "object" ||
      !["image", "audio"].includes(card.media.kind) ||
      !nonEmptyString(card.media.uri) ||
      !nonEmptyString(card.media.alt) ||
      !nonEmptyString(card.media.licenseRef) ||
      mediaKeys.some((key) => !["kind", "uri", "alt", "licenseRef"].includes(key))
    ) {
      errors.push("media는 kind, uri, alt, licenseRef만 가진 유효한 객체여야 한다.");
    }
  }

  return errors;
}

export function assertCards(cards) {
  const errors = [];
  if (!Array.isArray(cards) || cards.length === 0) {
    throw new ValidationError("카드", ["cards는 하나 이상의 항목이 있는 배열이어야 한다."]);
  }

  cards.forEach((card, index) => {
    validateCard(card).forEach((error) => errors.push(`cards[${index}]: ${error}`));
  });

  const ids = cards.map((card) => card.id);
  if (new Set(ids).size !== ids.length) errors.push("카드 id가 중복됐다.");
  assertNoErrors("카드", errors);
}

export function validateDeck(deck) {
  const errors = [];
  if (deck === null || typeof deck !== "object" || Array.isArray(deck)) return ["덱은 객체여야 한다."];

  for (const field of [
    "id",
    "title",
    "description",
    "category",
    "locale",
    "contentLanguage",
    "tier",
    "priority",
    "contentStrategy",
    "source",
    "license",
    "provenance",
    "reviewer",
    "status",
    "version",
    "chunkSize",
    "tags",
  ]) {
    if (!(field in deck)) errors.push(`${field} 필드가 필요하다.`);
  }

  if (!DECK_ID_PATTERN.test(deck.id ?? "")) errors.push("id 형식이 올바르지 않다.");
  if (!nonEmptyString(deck.title)) errors.push("title이 필요하다.");
  if (!nonEmptyString(deck.description)) errors.push("description이 필요하다.");
  if (!["language", "certification", "career", "general-knowledge", "k12-secondary"].includes(deck.category)) {
    errors.push("category가 허용 목록에 없다.");
  }
  if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(deck.locale ?? "")) errors.push("locale 형식이 올바르지 않다.");
  if (!["ko", "en", "ja"].includes(deck.contentLanguage)) errors.push("contentLanguage는 ko, en, ja 중 하나여야 한다.");
  if (!["free", "pro"].includes(deck.tier)) errors.push("tier는 free 또는 pro여야 한다.");
  if (!["P1", "P2", "P3"].includes(deck.priority)) errors.push("priority는 P1, P2, P3 중 하나여야 한다.");
  if (!["vocab-swipe-import", "ai-assisted-operator-batch"].includes(deck.contentStrategy)) {
    errors.push("contentStrategy가 허용 목록에 없다.");
  }
  if (!DECK_STATUSES.has(deck.status)) errors.push("status가 상태기계에 없다.");
  if (!Number.isInteger(deck.version) || deck.version < 1) errors.push("version은 1 이상의 정수여야 한다.");
  if (deck.chunkSize !== 200) errors.push("chunkSize는 200이어야 한다.");
  if (!Array.isArray(deck.tags) || deck.tags.some((tag) => !nonEmptyString(tag))) errors.push("tags가 올바르지 않다.");

  const source = deck.source ?? {};
  if (!["repository-snapshot", "operator-topic-brief"].includes(source.kind)) errors.push("source.kind가 올바르지 않다.");
  if (!nonEmptyString(source.name) || !nonEmptyString(source.uri) || typeof source.external !== "boolean") {
    errors.push("source name, uri, external이 필요하다.");
  }
  if (!nonEmptyString(source.revision)) errors.push("source.revision pin이 필요하다.");
  if (source.external === true && !COMMIT_PATTERN.test(source.commit ?? "")) {
    errors.push("외부 source는 40자리 commit pin이 필요하다.");
  }
  if (source.external === false && source.commit !== null) errors.push("내부 topic brief의 source.commit은 null이어야 한다.");

  const license = deck.license ?? {};
  if (!["single", "mixed"].includes(license.policy)) errors.push("license.policy가 올바르지 않다.");
  if (!Array.isArray(license.components) || license.components.length === 0) {
    errors.push("license.components가 하나 이상 필요하다.");
  } else {
    license.components.forEach((component, index) => {
      if (
        !nonEmptyString(component.id) ||
        !nonEmptyString(component.attribution) ||
        !nonEmptyString(component.evidenceUri) ||
        typeof component.commercialUse !== "boolean" ||
        typeof component.shareAlike !== "boolean"
      ) {
        errors.push(`license.components[${index}]가 불완전하다.`);
      }
      if (component.commercialUse !== true) errors.push(`license.components[${index}]는 상업 이용 가능 확인이 필요하다.`);
    });
  }
  if (!nonEmptyString(license.distributionNotice)) errors.push("license.distributionNotice가 필요하다.");
  if (license.components?.some((component) => component.shareAlike) && !/(동일조건|share.?alike|CC BY-SA)/i.test(license.distributionNotice ?? "")) {
    errors.push("ShareAlike 소스의 동일조건 배포 고지가 필요하다.");
  }

  const provenance = deck.provenance ?? {};
  if (!["planned", "imported", "ai-assisted"].includes(provenance.kind)) errors.push("provenance.kind가 올바르지 않다.");
  if (!nonEmptyString(provenance.recipe) || !nonEmptyString(provenance.generatedBy)) {
    errors.push("provenance.recipe와 generatedBy가 필요하다.");
  }
  if (deck.status === "planned") {
    if (provenance.inputDigest !== null) errors.push("planned 덱의 inputDigest는 생성 전이므로 null이어야 한다.");
  } else if (!SHA256_PATTERN.test(provenance.inputDigest ?? "")) {
    errors.push("생성 이후 덱은 sha256 provenance.inputDigest가 필요하다.");
  }

  const reviewer = deck.reviewer ?? {};
  if (!["pending", "approved", "rejected"].includes(reviewer.status)) errors.push("reviewer.status가 올바르지 않다.");
  if (![reviewer.name, reviewer.reviewedAt, reviewer.evidence].every(nullableNonEmptyString)) {
    errors.push("reviewer의 nullable 문자열 필드가 올바르지 않다.");
  }
  if (APPROVED_STATUSES.has(deck.status)) {
    if (
      reviewer.status !== "approved" ||
      !nonEmptyString(reviewer.name) ||
      !nonEmptyString(reviewer.reviewedAt) ||
      !nonEmptyString(reviewer.evidence)
    ) {
      errors.push(`${deck.status} 상태는 이름·시각·근거가 있는 사람 승인이 필요하다.`);
    }
  }
  if (deck.status === "published" && reviewer.status !== "approved") {
    errors.push("사람 승인 없는 덱은 published일 수 없다.");
  }

  return errors;
}

export function assertCatalog(catalog) {
  const errors = [];
  if (catalog?.schemaVersion !== 1) errors.push("schemaVersion은 1이어야 한다.");
  if (catalog?.catalogId !== "daoewo-v1") errors.push("catalogId는 daoewo-v1이어야 한다.");
  if (!Number.isInteger(catalog?.version) || catalog.version < 1) errors.push("version은 1 이상의 정수여야 한다.");
  if (catalog?.chunkSize !== 200) errors.push("catalog chunkSize는 200이어야 한다.");
  if (!Array.isArray(catalog?.decks)) {
    errors.push("decks 배열이 필요하다.");
  } else {
    if (catalog.decks.length !== 23) errors.push(`v2는 정확히 23덱이어야 한다(현재 ${catalog.decks.length}).`);
    catalog.decks.forEach((deck, index) => validateDeck(deck).forEach((error) => errors.push(`decks[${index}]: ${error}`)));

    const ids = catalog.decks.map((deck) => deck.id);
    if (new Set(ids).size !== ids.length) errors.push("deck id가 중복됐다.");

    const count = (field, value) => catalog.decks.filter((deck) => deck[field] === value).length;
    const expectedCounts = [
      ["tier", "free", 8],
      ["tier", "pro", 15],
      ["priority", "P1", 8],
      ["priority", "P2", 12],
      ["priority", "P3", 3],
    ];
    for (const [field, value, expected] of expectedCounts) {
      const actual = count(field, value);
      if (actual !== expected) errors.push(`${field}=${value}는 ${expected}개여야 한다(현재 ${actual}).`);
    }
  }

  assertNoErrors("카탈로그", errors);
}

export function assertBacklog(backlog) {
  const errors = [];
  if (backlog?.schemaVersion !== 1) errors.push("schemaVersion은 1이어야 한다.");
  if (!nonEmptyString(backlog?.privacy)) errors.push("privacy 집계 정책이 필요하다.");
  for (const source of BACKLOG_SOURCES) {
    if (!Number.isFinite(backlog?.scoring?.[source]) || backlog.scoring[source] < 0) {
      errors.push(`scoring.${source} 가중치가 필요하다.`);
    }
  }
  if (!Number.isFinite(backlog?.scoring?.proSignalBonus)) errors.push("Pro 요청 보너스가 필요하다.");
  if (!Number.isFinite(backlog?.scoring?.strengthScale)) errors.push("strengthScale이 필요하다.");
  if (!Array.isArray(backlog?.signals) || backlog.signals.length === 0) {
    errors.push("signals가 필요하다.");
  } else {
    const ids = new Set();
    const presentSources = new Set();
    backlog.signals.forEach((signal, index) => {
      presentSources.add(signal.source);
      if (!BACKLOG_SOURCES.includes(signal.source)) errors.push(`signals[${index}] source가 올바르지 않다.`);
      if (!nonEmptyString(signal.id) || ids.has(signal.id)) errors.push(`signals[${index}] id가 없거나 중복됐다.`);
      ids.add(signal.id);
      for (const field of ["topicKey", "topic", "category", "locale", "recordedAt", "evidence", "status"]) {
        if (!nonEmptyString(signal[field])) errors.push(`signals[${index}].${field}가 필요하다.`);
      }
      if (!Number.isInteger(signal.signalCount) || signal.signalCount < 1) errors.push(`signals[${index}].signalCount가 올바르지 않다.`);
      if (!Number.isInteger(signal.proSignalCount) || signal.proSignalCount < 0 || signal.proSignalCount > signal.signalCount) {
        errors.push(`signals[${index}].proSignalCount가 올바르지 않다.`);
      }
      if (!Number.isFinite(signal.strength) || signal.strength < 0 || signal.strength > 100) {
        errors.push(`signals[${index}].strength는 0~100이어야 한다.`);
      }
    });
    BACKLOG_SOURCES.forEach((source) => {
      if (!presentSources.has(source)) errors.push(`${source} 입력이 최소 하나 필요하다.`);
    });
  }
  assertNoErrors("우선순위 백로그", errors);
}

export function assertSchemas(cardSchema, catalogSchema) {
  const errors = [];
  if (cardSchema?.$schema !== "https://json-schema.org/draft/2020-12/schema") errors.push("Card schema draft가 올바르지 않다.");
  if (!cardSchema?.required?.includes("sourceRefs")) errors.push("Card schema에 sourceRefs가 필요하다.");
  if (cardSchema?.properties?.difficulty?.minimum !== 1 || cardSchema?.properties?.difficulty?.maximum !== 5) {
    errors.push("Card difficulty 범위가 1~5가 아니다.");
  }
  if (catalogSchema?.properties?.chunkSize?.const !== 200) errors.push("Catalog schema chunkSize가 200이 아니다.");
  if (catalogSchema?.properties?.decks?.minItems !== 23 || catalogSchema?.properties?.decks?.maxItems !== 23) {
    errors.push("Catalog schema가 정확히 23덱을 요구하지 않는다.");
  }
  assertNoErrors("JSON Schema", errors);
}
