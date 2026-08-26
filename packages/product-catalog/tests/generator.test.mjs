import assert from 'node:assert/strict';
import test from 'node:test';
import { digestJson, readJson } from '../../../content-pipeline/src/io.mjs';
import { CATALOG_PATH } from '../../../content-pipeline/src/paths.mjs';
import {
  buildPublicCatalog,
  buildBundledFreeContent,
  buildPublishedContent,
  renderCatalogModule,
  renderBundledFreeContentModule,
  renderPublishedContentModule,
  verifyPublication,
} from '../scripts/generate-catalog.mjs';

function approvedPublicationFixture(deckId = 'it-cs-interview-terms') {
  const reviewedAt = '2026-07-12T12:00:00.000Z';
  return readJson(CATALOG_PATH).then((catalog) => {
    const sourceDeck = structuredClone(catalog.decks.find((deck) => deck.id === deckId));
    sourceDeck.status = 'published';
    sourceDeck.provenance.kind = 'ai-assisted';
    sourceDeck.provenance.inputDigest = `sha256:${'a'.repeat(64)}`;
    sourceDeck.reviewer = {
      status: 'approved',
      name: '콘텐츠 검수자',
      reviewedAt,
      evidence: 'review-ticket://DAOEWO-CONTENT-TEST',
    };
    const cards = [
      {
        id: 'it-cs-interview-terms.card-1',
        deckId: sourceDeck.id,
        index: 0,
        front: `${sourceDeck.id} 공개 앞면`,
        back: `${sourceDeck.id} 공개 뒷면`,
        tags: ['자료구조'],
        difficulty: 1,
        sourceRefs: ['operator-note-v1'],
      },
    ];
    const payload = { schemaVersion: 1, deckId: sourceDeck.id, version: 1, chunkIndex: 0, cards };
    const checksum = digestJson(payload);
    const chunk = { ...payload, checksum };
    const publication = {
      schemaVersion: 1,
      deck: structuredClone(sourceDeck),
      cardCount: 1,
      chunkCount: 1,
      chunks: [{ chunkIndex: 0, checksum, path: 'chunk-00000.json' }],
      workflow: {
        state: 'published',
        history: [{ from: 'chunked', to: 'published', at: reviewedAt, actor: 'local-publisher-v1' }],
      },
    };
    return { catalog, sourceDeck, publication, chunks: [chunk] };
  });
}

test('production body verifier는 source와 publication 양쪽의 사람 승인·published·checksum을 요구한다', async () => {
  const fixture = await approvedPublicationFixture();
  const verified = verifyPublication(fixture);
  assert.equal(verified.deckId, fixture.sourceDeck.id);
  assert.equal(verified.cardCount, 1);
  assert.equal(verified.chunks[0].cards.length, 1);

  const plannedSource = structuredClone(fixture);
  plannedSource.sourceDeck.status = 'awaiting-human-approval';
  plannedSource.sourceDeck.reviewer = { status: 'pending', name: null, reviewedAt: null, evidence: null };
  assert.throws(() => verifyPublication(plannedSource), /published|사람 승인/);

  const pendingPublication = structuredClone(fixture);
  pendingPublication.publication.deck.reviewer = { status: 'pending', name: null, reviewedAt: null, evidence: null };
  assert.throws(() => verifyPublication(pendingPublication), /사람 승인|일치하지 않는다/);

  const corruptChunk = structuredClone(fixture);
  corruptChunk.chunks[0].cards[0].back = '변조된 본문';
  assert.throws(() => verifyPublication(corruptChunk), /checksum/);

  const fixtureOnly = structuredClone(fixture);
  fixtureOnly.publication.fixtureOnly = true;
  assert.throws(() => verifyPublication(fixtureOnly), /fixtureOnly/);
});

test('source=free/publication=pro tier 불일치는 client-safe 검증 전에 거부한다', async () => {
  const fixture = await approvedPublicationFixture('english-essential-intro');
  fixture.publication.deck.tier = 'pro';
  assert.throws(() => verifyPublication(fixture), /deck\.tier가 일치하지 않는다/);
});

test('미승인 source에서는 23 metadata만 생성하고 본문 export는 비어 있다', async () => {
  const catalog = await readJson(CATALOG_PATH);
  const publications = new Map();
  const runtime = buildPublicCatalog(catalog, publications);
  const content = buildPublishedContent(publications);
  assert.equal(runtime.decks.length, 23);
  assert.ok(runtime.decks.every((deck) => deck.availability === 'coming-soon'));
  assert.deepEqual(content, {});
});

test('client-safe generated export는 승인된 Free 본문만 포함하고 Pro 본문은 절대 포함하지 않는다', async () => {
  const freeFixture = await approvedPublicationFixture('english-essential-intro');
  const proFixture = await approvedPublicationFixture('english-toeic-advanced');
  const publications = new Map([
    [freeFixture.sourceDeck.id, verifyPublication(freeFixture)],
    [proFixture.sourceDeck.id, verifyPublication(proFixture)],
  ]);

  const bundled = buildBundledFreeContent(freeFixture.catalog, publications);
  const rendered = renderBundledFreeContentModule(bundled);

  assert.deepEqual(Object.keys(bundled), ['english-essential-intro']);
  assert.match(rendered, /english-essential-intro 공개 앞면/);
  assert.equal(rendered.includes('english-toeic-advanced'), false);
  assert.equal(rendered.includes('english-toeic-advanced 공개 앞면'), false);
  assert.equal(rendered.includes('english-toeic-advanced 공개 뒷면'), false);
});

test('같은 source 입력은 byte-identical TypeScript module을 생성한다', async () => {
  const catalog = await readJson(CATALOG_PATH);
  const firstCatalog = renderCatalogModule(buildPublicCatalog(catalog, new Map()));
  const secondCatalog = renderCatalogModule(buildPublicCatalog(structuredClone(catalog), new Map()));
  const firstContent = renderPublishedContentModule(buildPublishedContent(new Map()));
  const secondContent = renderPublishedContentModule(buildPublishedContent(new Map()));
  const firstBundledFree = renderBundledFreeContentModule(buildBundledFreeContent(catalog, new Map()));
  const secondBundledFree = renderBundledFreeContentModule(
    buildBundledFreeContent(structuredClone(catalog), new Map()),
  );
  assert.equal(firstCatalog, secondCatalog);
  assert.equal(firstContent, secondContent);
  assert.equal(firstBundledFree, secondBundledFree);
  assert.equal(firstCatalog.includes('generatedAt'), false);
});
