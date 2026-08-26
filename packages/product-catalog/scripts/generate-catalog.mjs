import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digestJson, readJson } from '../../../content-pipeline/src/io.mjs';
import {
  assertCards,
  assertCatalog,
  validateDeck,
  ValidationError,
} from '../../../content-pipeline/src/validation.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '../..');
const SOURCE_CATALOG_PATH = path.join(REPO_ROOT, 'content-pipeline', 'manifests', 'v1.json');
const PUBLICATIONS_ROOT = path.join(REPO_ROOT, 'content-pipeline', 'published', 'decks');
const CATALOG_OUTPUT_PATH = path.join(PACKAGE_ROOT, 'src', 'catalog.generated.ts');
const CONTENT_OUTPUT_PATH = path.join(PACKAGE_ROOT, 'src', 'published-content.generated.ts');
const BUNDLED_FREE_CONTENT_OUTPUT_PATH = path.join(
  PACKAGE_ROOT,
  'src',
  'bundled-free-content.generated.ts',
);
const PRIORITY_ORDER = { P1: 0, P2: 1, P3: 2 };

function compareBytes(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort(compareBytes);
}

function assertIsoDate(value, label) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error(`${label}은 UTC ISO date-time이어야 한다.`);
  }
}

function assertApprovedPublishedDeck(deck, label) {
  const errors = validateDeck(deck);
  if (errors.length > 0) throw new ValidationError(label, errors);
  if (deck.status !== 'published') throw new Error(`${label} status는 published여야 한다.`);
  if (
    deck.reviewer.status !== 'approved' ||
    typeof deck.reviewer.name !== 'string' ||
    typeof deck.reviewer.evidence !== 'string' ||
    typeof deck.reviewer.reviewedAt !== 'string'
  ) {
    throw new Error(`${label}에 이름·시각·근거가 있는 사람 승인이 필요하다.`);
  }
  assertIsoDate(deck.reviewer.reviewedAt, `${label}.reviewer.reviewedAt`);
}

function assertSameApproval(sourceDeck, publicationDeck) {
  for (const field of ['status', 'version', 'chunkSize', 'tier']) {
    if (sourceDeck[field] !== publicationDeck[field]) throw new Error(`source/publication deck.${field}가 일치하지 않는다.`);
  }
  for (const field of ['status', 'name', 'reviewedAt', 'evidence']) {
    if (sourceDeck.reviewer[field] !== publicationDeck.reviewer[field]) {
      throw new Error(`source/publication reviewer.${field}가 일치하지 않는다.`);
    }
  }
  if (sourceDeck.provenance.inputDigest !== publicationDeck.provenance.inputDigest) {
    throw new Error('source/publication provenance.inputDigest가 일치하지 않는다.');
  }
  // tier만이 아니라 contentStrategy/source/license까지 승인 시점의 전체 snapshot을 고정한다.
  if (digestJson(sourceDeck) !== digestJson(publicationDeck)) {
    throw new Error('source/publication deck 승인 snapshot 전체가 일치하지 않는다.');
  }
}

function publishedAtFromWorkflow(workflow) {
  if (workflow?.state !== 'published' || !Array.isArray(workflow.history)) {
    throw new Error('publication workflow가 published로 끝나지 않았다.');
  }
  const transition = [...workflow.history].reverse().find((entry) => entry?.to === 'published');
  assertIsoDate(transition?.at, 'publication published transition.at');
  return transition.at;
}

/** 파일 로더와 테스트가 공유하는 production 본문 승인 검증이다. */
export function verifyPublication({ sourceDeck, publication, chunks }) {
  if (publication?.fixtureOnly === true) throw new Error('fixtureOnly publication은 production export할 수 없다.');
  assertApprovedPublishedDeck(sourceDeck, `source deck ${sourceDeck?.id ?? 'unknown'}`);
  assertApprovedPublishedDeck(publication?.deck, `publication deck ${sourceDeck.id}`);
  assertSameApproval(sourceDeck, publication.deck);

  if (publication.schemaVersion !== 1) throw new Error('publication schemaVersion은 1이어야 한다.');
  if (publication.deck.id !== sourceDeck.id) throw new Error('publication deck id가 source와 일치하지 않는다.');
  if (!Number.isInteger(publication.cardCount) || publication.cardCount < 1) throw new Error('publication cardCount가 올바르지 않다.');
  if (!Number.isInteger(publication.chunkCount) || publication.chunkCount < 1) throw new Error('publication chunkCount가 올바르지 않다.');
  if (!Array.isArray(publication.chunks) || publication.chunks.length !== publication.chunkCount) {
    throw new Error('publication chunk descriptor 수가 chunkCount와 다르다.');
  }
  if (!Array.isArray(chunks) || chunks.length !== publication.chunkCount) {
    throw new Error('실제 chunk 수가 publication chunkCount와 다르다.');
  }

  const allCards = [];
  const verifiedChunks = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const descriptor = publication.chunks[index];
    const expectedPath = `chunk-${String(index).padStart(5, '0')}.json`;
    if (descriptor.chunkIndex !== index || descriptor.path !== expectedPath || chunk.chunkIndex !== index) {
      throw new Error(`chunk ${index}의 index/path가 연속적이지 않다.`);
    }
    if (chunk.schemaVersion !== 1 || chunk.deckId !== sourceDeck.id || chunk.version !== sourceDeck.version) {
      throw new Error(`chunk ${index}의 deck/version/schema가 source와 다르다.`);
    }
    if (!Array.isArray(chunk.cards) || chunk.cards.length < 1 || chunk.cards.length > 200) {
      throw new Error(`chunk ${index}는 1~200장이어야 한다.`);
    }
    assertCards(chunk.cards);
    const payload = {
      schemaVersion: chunk.schemaVersion,
      deckId: chunk.deckId,
      version: chunk.version,
      chunkIndex: chunk.chunkIndex,
      cards: chunk.cards,
    };
    const checksum = digestJson(payload);
    if (chunk.checksum !== checksum || descriptor.checksum !== checksum) {
      throw new Error(`chunk ${index} checksum이 일치하지 않는다.`);
    }
    for (const card of chunk.cards) {
      if (card.deckId !== sourceDeck.id || card.index !== allCards.length) {
        throw new Error(`chunk ${index}의 card deckId/index가 전역 순서와 다르다.`);
      }
      allCards.push(card);
    }
    verifiedChunks.push({ chunkIndex: index, checksum, cards: chunk.cards });
  }

  if (allCards.length !== publication.cardCount) throw new Error('검증된 카드 수가 publication.cardCount와 다르다.');
  if (new Set(allCards.map((card) => card.id)).size !== allCards.length) throw new Error('publication 전체에서 card id가 중복됐다.');
  const publishedAt = publishedAtFromWorkflow(publication.workflow);

  return {
    deckId: sourceDeck.id,
    version: sourceDeck.version,
    chunkSize: 200,
    cardCount: allCards.length,
    publishedAt,
    publicationDigest: digestJson(publication),
    chunks: verifiedChunks,
  };
}

async function readDirectory(directory) {
  try {
    return (await readdir(directory, { withFileTypes: true })).sort((left, right) => compareBytes(left.name, right.name));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function loadPublicationDirectory(sourceDeck, versionDirectory) {
  const directory = path.join(PUBLICATIONS_ROOT, sourceDeck.id, versionDirectory);
  const publication = await readJson(path.join(directory, 'manifest.json'));
  const descriptors = publication?.chunks;
  if (!Array.isArray(descriptors)) throw new Error(`${directory}/manifest.json에 chunks가 없다.`);

  const expectedFiles = new Set(['manifest.json', ...descriptors.map((descriptor) => descriptor.path)]);
  const entries = await readDirectory(directory);
  for (const entry of entries) {
    if (!entry.isFile() || !expectedFiles.has(entry.name)) {
      throw new Error(`publication 경로에 manifest가 선언하지 않은 파일이 있다: ${path.join(directory, entry.name)}`);
    }
  }
  if (entries.length !== expectedFiles.size) throw new Error(`${directory}의 chunk 파일 수가 manifest와 다르다.`);

  const chunks = [];
  for (const descriptor of descriptors) {
    if (!/^chunk-\d{5}\.json$/.test(descriptor.path)) throw new Error(`안전하지 않은 chunk path: ${descriptor.path}`);
    chunks.push(await readJson(path.join(directory, descriptor.path)));
  }
  return verifyPublication({ sourceDeck, publication, chunks });
}

export async function loadVerifiedPublications(sourceCatalog) {
  const publications = new Map();
  const deckEntries = await readDirectory(PUBLICATIONS_ROOT);
  for (const deckEntry of deckEntries) {
    if (!deckEntry.isDirectory()) throw new Error(`published/decks에는 deck directory만 허용한다: ${deckEntry.name}`);
    const sourceDeck = sourceCatalog.decks.find((deck) => deck.id === deckEntry.name);
    if (sourceDeck === undefined) throw new Error(`source manifest에 없는 publication deck: ${deckEntry.name}`);

    const versionEntries = await readDirectory(path.join(PUBLICATIONS_ROOT, deckEntry.name));
    for (const versionEntry of versionEntries) {
      if (!versionEntry.isDirectory() || !/^v[1-9]\d*$/.test(versionEntry.name)) {
        throw new Error(`publication version directory 형식이 올바르지 않다: ${versionEntry.name}`);
      }
      const version = Number(versionEntry.name.slice(1));
      if (version !== sourceDeck.version) continue;
      if (publications.has(sourceDeck.id)) throw new Error(`현재 version publication이 중복됐다: ${sourceDeck.id}`);
      publications.set(sourceDeck.id, await loadPublicationDirectory(sourceDeck, versionEntry.name));
    }
  }

  for (const deck of sourceCatalog.decks) {
    if (deck.status === 'published' && !publications.has(deck.id)) {
      throw new Error(`source manifest는 published지만 검증 가능한 본문이 없다: ${deck.id}`);
    }
    if (deck.status !== 'published' && publications.has(deck.id)) {
      throw new Error(`미승인 source deck의 publication을 export할 수 없다: ${deck.id}`);
    }
  }
  return publications;
}

export function buildPublicCatalog(sourceCatalog, publications) {
  assertCatalog(sourceCatalog);
  const sorted = [...sourceCatalog.decks].sort(
    (left, right) => PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority] || compareBytes(left.id, right.id),
  );
  const decks = sorted.map((deck, displayOrder) => {
    const published = publications.get(deck.id);
    return {
      id: deck.id,
      displayOrder,
      title: deck.title,
      description: deck.description,
      category: deck.category,
      locale: deck.locale,
      contentLanguage: deck.contentLanguage,
      tier: deck.tier,
      priority: deck.priority,
      sourceType: deck.contentStrategy === 'vocab-swipe-import' ? 'curated-import' : 'ai-assisted-operator-batch',
      availability: published === undefined ? 'coming-soon' : 'published',
      version: deck.version,
      cardCount: published?.cardCount ?? null,
      chunkSize: 200,
      tags: [...deck.tags],
      license: {
        ids: uniqueSorted(deck.license.components.map((component) => component.id)),
        attributions: uniqueSorted(deck.license.components.map((component) => component.attribution)),
        distributionNotice: deck.license.distributionNotice,
      },
      publishedAt: published?.publishedAt ?? null,
    };
  });

  if (decks.length !== 23 || new Set(decks.map((deck) => deck.id)).size !== 23) {
    throw new Error('public catalog는 중복 없는 23개 metadata여야 한다.');
  }
  for (const deck of decks) {
    if (deck.availability === 'coming-soon' && (deck.cardCount !== null || deck.publishedAt !== null)) {
      throw new Error(`미발행 metadata에 본문 수나 발행 시각이 노출됐다: ${deck.id}`);
    }
    if (deck.availability === 'published' && (deck.cardCount === null || deck.publishedAt === null)) {
      throw new Error(`발행 metadata에 본문 수나 발행 시각이 없다: ${deck.id}`);
    }
  }

  return {
    schemaVersion: 1,
    catalogId: 'daoewo-v1',
    version: sourceCatalog.version,
    sourceDigest: digestJson(sourceCatalog),
    decks,
  };
}

export function buildPublishedContent(publications) {
  return Object.fromEntries([...publications.entries()].sort(([left], [right]) => compareBytes(left, right)));
}

/**
 * 앱 바이너리에 포함해도 되는 사람 승인 완료 Free 본문만 별도 생성한다.
 * 서버 전용 publication map을 그대로 client subpath로 넘기지 않는다.
 */
export function buildBundledFreeContent(sourceCatalog, publications) {
  const tierByDeckId = new Map(sourceCatalog.decks.map((deck) => [deck.id, deck.tier]));
  const entries = [...publications.entries()]
    .filter(([deckId]) => tierByDeckId.get(deckId) === 'free')
    .sort(([left], [right]) => compareBytes(left, right));

  for (const [deckId] of entries) {
    if (tierByDeckId.get(deckId) !== 'free') {
      throw new Error(`client-safe bundle에는 Free 본문만 포함할 수 있다: ${deckId}`);
    }
  }

  return Object.fromEntries(entries);
}

export function renderCatalogModule(catalog) {
  return `// Generated by scripts/generate-catalog.mjs. Do not edit.\n` +
    `import type { PublicCatalog } from './types.js';\n\n` +
    `export const PUBLIC_CATALOG = ${JSON.stringify(catalog, null, 2)} as const satisfies PublicCatalog;\n`;
}

export function renderPublishedContentModule(content) {
  return `// Generated by scripts/generate-catalog.mjs. Do not edit.\n` +
    `import type { PublishedDeckContent } from './types.js';\n\n` +
    `export const PUBLISHED_DECK_CONTENT = ${JSON.stringify(content, null, 2)} as const satisfies Readonly<Record<string, PublishedDeckContent>>;\n`;
}

export function renderBundledFreeContentModule(content) {
  return `// Generated by scripts/generate-catalog.mjs. Do not edit.\n` +
    `import type { PublishedDeckContent } from './types.js';\n\n` +
    `/** 사람 승인·checksum 검증이 끝난 Free 본문만 포함하는 client-safe bundle이다. */\n` +
    `export const BUNDLED_FREE_DECK_CONTENT = ${JSON.stringify(content, null, 2)} as const satisfies Readonly<Record<string, PublishedDeckContent>>;\n`;
}

async function writeAtomic(filePath, content) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, content, 'utf8');
  await rename(temporaryPath, filePath);
}

async function assertGeneratedFile(filePath, expected) {
  let actual;
  try {
    actual = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`generated 파일이 없다: ${filePath}. pnpm run generate를 실행한다.`);
    throw error;
  }
  if (actual !== expected) throw new Error(`generated 파일이 source와 다르다: ${filePath}. pnpm run generate를 실행한다.`);
}

export async function generateCatalog({ check = false } = {}) {
  const sourceCatalog = await readJson(SOURCE_CATALOG_PATH);
  assertCatalog(sourceCatalog);
  const publications = await loadVerifiedPublications(sourceCatalog);
  const catalogOutput = renderCatalogModule(buildPublicCatalog(sourceCatalog, publications));
  const contentOutput = renderPublishedContentModule(buildPublishedContent(publications));
  const bundledFreeContentOutput = renderBundledFreeContentModule(
    buildBundledFreeContent(sourceCatalog, publications),
  );

  if (check) {
    await Promise.all([
      assertGeneratedFile(CATALOG_OUTPUT_PATH, catalogOutput),
      assertGeneratedFile(CONTENT_OUTPUT_PATH, contentOutput),
      assertGeneratedFile(BUNDLED_FREE_CONTENT_OUTPUT_PATH, bundledFreeContentOutput),
    ]);
  } else {
    await Promise.all([
      writeAtomic(CATALOG_OUTPUT_PATH, catalogOutput),
      writeAtomic(CONTENT_OUTPUT_PATH, contentOutput),
      writeAtomic(BUNDLED_FREE_CONTENT_OUTPUT_PATH, bundledFreeContentOutput),
    ]);
  }

  return { metadataCount: sourceCatalog.decks.length, publishedBodyCount: publications.size };
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const result = await generateCatalog({ check: process.argv.includes('--check') });
    console.log(JSON.stringify({ ok: true, check: process.argv.includes('--check'), ...result }));
  } catch (error) {
    console.error(error?.message ?? error);
    process.exitCode = 1;
  }
}
