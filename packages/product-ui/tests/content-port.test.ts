import {createInitialCardProgress} from '@daoewo/product-core';

import {
  createDemoRuntime,
  type DaoewoDeckRequestInput,
  type DaoewoProgressBatch,
} from '../src/runtime';

describe('DaoewoContentPort demo 계약', () => {
  it('카탈로그에는 14덱 metadata만 반환하고 카드 본문은 포함하지 않는다', async () => {
    const runtime = createDemoRuntime({
      now: () => new Date('2026-07-12T09:00:00.000Z'),
    });
    const catalog = await runtime.content.listCatalog();

    expect(catalog).toHaveLength(14);
    expect(catalog.filter(deck => deck.tier === 'free')).toHaveLength(6);
    expect(catalog.filter(deck => deck.tier === 'pro')).toHaveLength(8);
    expect(catalog.every(deck => deck.availability === 'published')).toBe(true);
    expect(JSON.stringify(catalog)).not.toContain('勉強する');
    expect(catalog.every(deck => !('cards' in deck))).toBe(true);
  });

  it('카드 본문은 승인된 session window에서만 제공한다', async () => {
    const runtime = createDemoRuntime({
      now: () => new Date('2026-07-12T09:00:00.000Z'),
    });

    const window = await runtime.content.getCardWindow({deckId: 'jlpt-n5'});
    expect(window.deckId).toBe('jlpt-n5');
    expect(window.cards).toHaveLength(5);
    expect(window.cards[0]?.front).toBe('勉強する');
  });

  it('Free entitlement에서는 Pro 본문 window를 fail-closed한다', async () => {
    const runtime = createDemoRuntime();

    await expect(
      runtime.content.getCardWindow({deckId: 'english-advanced'}),
    ).rejects.toThrow();

    await runtime.purchase.purchase('annual');
    await expect(
      runtime.content.getCardWindow({deckId: 'english-advanced'}),
    ).resolves.toMatchObject({deckId: 'english-advanced', targetCount: 5});
  });

  it('목표, progress batch, 덱 요청을 adapter 계약으로 저장한다', async () => {
    const now = new Date('2026-07-12T09:00:00.000Z');
    const runtime = createDemoRuntime({now: () => now});
    const goal = await runtime.content.createGoal({
      deckId: 'jlpt-n5',
      mode: 'days',
      value: 30,
      startDate: '2026-07-12',
    });
    expect(goal).toMatchObject({deckId: 'jlpt-n5', days: 30, dailyCount: 8});

    const batch: DaoewoProgressBatch = {
      deckId: 'jlpt-n5',
      goalKey: goal.key,
      windowId: 'window-test',
      progresses: [createInitialCardProgress('jp-1', 'jlpt-n5', now)],
    };
    await runtime.content.commitProgressBatch(batch);
    expect(
      await runtime.storage.getItem<DaoewoProgressBatch>(
        'progress-batch:jlpt-n5',
      ),
    ).toEqual(batch);

    const request: DaoewoDeckRequestInput = {
      topic: '관세법 핵심 조문',
      category: '자격증',
      locale: 'ko',
      note: '시험 일정 참고',
    };
    await runtime.content.submitDeckRequest(request);
    expect(
      await runtime.storage.getItem<readonly DaoewoDeckRequestInput[]>(
        'deck-requests',
      ),
    ).toEqual([request]);
  });
});
