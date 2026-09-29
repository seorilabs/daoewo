import type {SyncEnvelope, LearningSyncSnapshot} from '@daoewo/product-core';

import {
  assertMobileContentPreviewArtifact,
  createMobileContentPreviewRuntime,
  type MobileContentPreviewArtifact,
} from '../src/dev-preview/content-preview-runtime';

const ARTIFACT: MobileContentPreviewArtifact = {
  schemaVersion: 1,
  kind: 'daoewo-mobile-content-preview',
  generatedAt: '2026-07-14T00:00:00.000Z',
  notice: 'DEV · 미승인 콘텐츠 · 외부 전송 금지',
  sourceRecords: [
    {
      file: 'preview.json',
      digest:
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
  ],
  decks: [
    {
      id: 'preview-deck',
      title: '미승인 덱',
      description: '검수 전 콘텐츠',
      category: 'certification',
      categoryLabel: '자격증',
      locale: 'ko-KR',
      contentLanguage: 'ko',
      tier: 'pro',
      source: 'ai-batch',
      priority: 'P1',
      version: 1,
      tags: ['DEV'],
      workflowState: 'awaiting-human-approval',
      reviewStatus: 'pending',
      cards: [
        {
          id: 'preview-deck.card-1',
          deckId: 'preview-deck',
          front: '질문 1',
          back: '답 1',
          tags: ['테스트'],
          difficulty: 2,
          locale: 'ko-KR',
        },
        {
          id: 'preview-deck.card-2',
          deckId: 'preview-deck',
          front: '질문 2',
          back: '답 2',
          tags: ['테스트'],
          difficulty: 3,
          locale: 'ko-KR',
        },
      ],
    },
  ],
};

describe('mobile DEV 콘텐츠 Preview runtime', () => {
  it('artifact 실제 카드 수로 카탈로그와 학습 window를 구성한다', async () => {
    const runtime = createMobileContentPreviewRuntime(ARTIFACT, {
      now: () => new Date('2026-07-14T12:00:00.000Z'),
    });

    await expect(runtime.content.listCatalog()).resolves.toEqual([
      expect.objectContaining({
        id: 'preview-deck',
        cardCount: 2,
        availability: 'published',
        tier: 'pro',
        source: 'ai-batch',
      }),
    ]);
    const goal = await runtime.content.createGoal({
      deckId: 'preview-deck',
      mode: 'daily-count',
      value: 1,
      startDate: '2026-07-14',
    });
    await expect(
      runtime.content.getCardWindow({
        deckId: 'preview-deck',
        goalKey: goal.key,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        deckId: 'preview-deck',
        goalKey: goal.key,
        targetCount: 1,
        cards: [expect.objectContaining({id: 'preview-deck.card-1'})],
      }),
    );
  });

  it('Analytics, cloud sync, purchase, share, notification, request를 외부 전송 불가 상태로 둔다', async () => {
    const runtime = createMobileContentPreviewRuntime(ARTIFACT);
    await expect(
      runtime.analytics.track('memo_catalog_browse', {category: '자격증'}),
    ).resolves.toBeUndefined();
    expect(runtime.sync.availability).toBe('local-only');
    await expect(runtime.sync.pull('dev-content-preview')).resolves.toBeNull();
    const envelope = {
      schemaVersion: 1,
      revision: 0,
      updatedAt: '2026-07-14T00:00:00.000Z',
      payload: {goals: [], progresses: [], reviewQueue: []},
    } as unknown as SyncEnvelope<LearningSyncSnapshot>;
    await expect(runtime.sync.push('dev-content-preview', envelope)).resolves.toBe(
      envelope,
    );

    await expect(runtime.purchase.getEntitlement()).resolves.toEqual(
      expect.objectContaining({plan: 'pro', source: 'dev-content-preview'}),
    );
    await expect(runtime.purchase.purchase('monthly')).rejects.toThrow(
      'DEV_CONTENT_PREVIEW_EXTERNAL_CAPABILITY_DISABLED',
    );
    await expect(runtime.purchase.restore()).rejects.toThrow(
      'DEV_CONTENT_PREVIEW_EXTERNAL_CAPABILITY_DISABLED',
    );
    expect(runtime.sharing.availability).toBe('unsupported');
    await expect(
      runtime.sharing.shareText({title: '제목', message: '본문'}),
    ).rejects.toThrow('DEV_CONTENT_PREVIEW_EXTERNAL_CAPABILITY_DISABLED');
    expect(runtime.notifications.availability).toBe('unsupported');
    await expect(
      runtime.notifications.applyPreferences({
        dailyReminder: true,
        reviewReminder: false,
        nextReviewAt: null,
      }),
    ).rejects.toThrow('NOTIFICATIONS_UNSUPPORTED');
    expect(runtime.deckReadyNotifications.availability).toBe('unsupported');
    await expect(
      runtime.content.submitDeckRequest({
        topic: '새 덱',
        category: '자격증',
        locale: 'ko-KR',
      }),
    ).rejects.toThrow('DEV_CONTENT_PREVIEW_EXTERNAL_CAPABILITY_DISABLED');
  });

  it('승인 상태나 덱과 카드가 불일치한 artifact를 거부한다', () => {
    expect(() =>
      assertMobileContentPreviewArtifact({
        ...ARTIFACT,
        decks: [
          {
            ...ARTIFACT.decks[0],
            workflowState: 'approved',
          } as unknown as MobileContentPreviewArtifact['decks'][number],
        ],
      }),
    ).toThrow('DEV_CONTENT_PREVIEW_DECK_INVALID');
    expect(() =>
      assertMobileContentPreviewArtifact({
        ...ARTIFACT,
        decks: [
          {
            ...ARTIFACT.decks[0],
            cards: [
              {
                ...ARTIFACT.decks[0].cards[0],
                deckId: 'other-deck',
              },
            ],
          },
        ],
      }),
    ).toThrow('DEV_CONTENT_PREVIEW_CARD_INVALID');
  });
});
