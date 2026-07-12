import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as publicApi from '../dist/index.js';
import {
  getPublishedDeckContent,
  PUBLISHED_DECK_CONTENT,
} from '../dist/published-content.js';
import {
  BUNDLED_FREE_DECK_CONTENT,
  getBundledFreeDeckContent,
} from '../dist/bundled-free-content.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('public runtime catalog는 잠금 덱을 포함한 14개 metadata를 deterministic 순서로 노출한다', () => {
  const catalog = publicApi.PUBLIC_CATALOG;
  assert.equal(catalog.decks.length, 14);
  assert.equal(new Set(catalog.decks.map((deck) => deck.id)).size, 14);
  assert.match(catalog.sourceDigest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(catalog.decks.map((deck) => deck.displayOrder), Array.from({ length: 14 }, (_, index) => index));
  assert.deepEqual(catalog.decks.map((deck) => deck.priority), [
    'P1', 'P1', 'P1', 'P1', 'P1', 'P1', 'P1',
    'P2', 'P2', 'P2', 'P2', 'P2',
    'P3', 'P3',
  ]);
  assert.equal(catalog.decks.filter((deck) => deck.tier === 'free').length, 6);
  assert.equal(catalog.decks.filter((deck) => deck.tier === 'pro').length, 8);
});

test('Free는 Pro metadata 8개를 locked로 보며 Pro도 14개 metadata를 모두 본다', () => {
  const free = publicApi.listPublicCatalog('free');
  const pro = publicApi.listPublicCatalog('pro');
  assert.equal(free.length, 14);
  assert.equal(pro.length, 14);
  assert.equal(free.filter((deck) => deck.locked).length, 8);
  assert.equal(pro.filter((deck) => deck.locked).length, 0);
  assert.ok(free.every((deck) => deck.available === false));
  assert.equal(publicApi.getPublicDeckMetadata('japanese-jlpt-n5-preview')?.contentLanguage, 'ja');
  assert.equal(publicApi.getPublicDeckMetadata('missing'), null);
});

test('현재 미승인 catalog는 coming-soon/null count이며 production 본문 export가 비어 있다', () => {
  assert.ok(publicApi.PUBLIC_CATALOG.decks.every((deck) => deck.availability === 'coming-soon'));
  assert.ok(publicApi.PUBLIC_CATALOG.decks.every((deck) => deck.cardCount === null && deck.publishedAt === null));
  assert.deepEqual(PUBLISHED_DECK_CONTENT, {});
  assert.deepEqual(BUNDLED_FREE_DECK_CONTENT, {});
  assert.equal(getPublishedDeckContent('it-cs-interview-terms'), null);
  assert.equal(getBundledFreeDeckContent('english-essential-intro'), null);
  assert.equal('PUBLISHED_DECK_CONTENT' in publicApi, false, 'root/client export가 server-only 본문을 재수출하면 안 된다.');
  assert.equal('BUNDLED_FREE_DECK_CONTENT' in publicApi, false, 'root metadata export가 본문을 재수출하면 안 된다.');
});

test('runtime schema는 14 metadata와 200장 server chunk를 선언한다', async () => {
  const publicSchema = JSON.parse(await readFile(path.join(packageRoot, 'schemas', 'public-catalog.schema.json'), 'utf8'));
  const contentSchema = JSON.parse(await readFile(path.join(packageRoot, 'schemas', 'published-content.schema.json'), 'utf8'));
  assert.equal(publicSchema.properties.decks.minItems, 14);
  assert.equal(publicSchema.properties.decks.maxItems, 14);
  assert.equal(publicSchema.$defs.deck.properties.chunkSize.const, 200);
  assert.equal(contentSchema.$defs.deckContent.properties.chunks.items.properties.cards.maxItems, 200);
  assert.equal(
    contentSchema.$defs.deckContent.properties.chunks.items.properties.cards.items.$ref,
    'https://daoewo.seorilabs.com/schemas/card.schema.json',
  );
});
