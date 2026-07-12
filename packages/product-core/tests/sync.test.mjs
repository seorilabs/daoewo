import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createInitialCardProgress,
  createStudyGoal,
  mergeLearningBackupSnapshots,
} from '../dist/index.js';

const NOW = new Date('2026-07-12T00:00:00.000Z');

function deck(deckId, updatedAt, active = true) {
  return {
    deckId,
    deckVersion: 1,
    active,
    goal: createStudyGoal({
      deckId,
      cardIds: [`${deckId}-1`],
      startDate: '2026-07-12',
      mode: 'days',
      value: 1,
    }),
    progresses: [
      {
        cardIndex: 0,
        state: {
          ...createInitialCardProgress(`${deckId}-1`, deckId, NOW),
          updatedAt,
        },
      },
    ],
  };
}

test('learning backup merge is commutative, idempotent, and keeps newer card state', () => {
  const older = {
    version: 1,
    freeDecks: [deck('deck-a', '2026-07-12T00:00:00.000Z')],
    sessions: [],
  };
  const newer = {
    version: 1,
    freeDecks: [deck('deck-a', '2026-07-12T01:00:00.000Z')],
    sessions: [],
  };

  const merged = mergeLearningBackupSnapshots(older, newer);
  assert.deepEqual(merged, mergeLearningBackupSnapshots(newer, older));
  assert.deepEqual(merged, mergeLearningBackupSnapshots(merged, older));
  assert.equal(
    merged.freeDecks[0].progresses[0].state.updatedAt,
    '2026-07-12T01:00:00.000Z',
  );
});

test('Free keeps one active deck while Pro keeps multiple active Free decks', () => {
  const first = {version: 1, freeDecks: [deck('deck-a', '2026-07-12T00:00:00.000Z')], sessions: []};
  const second = {version: 1, freeDecks: [deck('deck-b', '2026-07-12T01:00:00.000Z')], sessions: []};

  assert.deepEqual(
    mergeLearningBackupSnapshots(first, second).freeDecks
      .filter(item => item.active)
      .map(item => item.deckId),
    ['deck-b'],
  );
  assert.deepEqual(
    mergeLearningBackupSnapshots(first, second, true).freeDecks
      .filter(item => item.active)
      .map(item => item.deckId),
    ['deck-a', 'deck-b'],
  );
});
