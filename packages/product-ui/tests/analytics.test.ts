import {
  DAOEWO_ANALYTICS_PARAMETER_KEYS,
  trackDaoewoEvent,
  type DaoewoAnalytics,
  type DaoewoAnalyticsEventMap,
  type DaoewoAnalyticsEventName,
  type DaoewoAnalyticsValue,
} from '../src/runtime';

const REQUIRED_EVENTS = [
  'memo_deck_open',
  'memo_goal_set',
  'memo_session_start',
  'memo_session_complete',
  'memo_review_outcome',
  'memo_catalog_browse',
  'memo_premium_deck_tap',
  'memo_deck_request',
  'memo_paywall_view',
  'memo_subscribe',
  'memo_streak_extend',
  'memo_share',
] as const;

describe('다외워 analytics 명세', () => {
  it('기획서의 필수 이벤트 12개와 정확히 일치한다', () => {
    expect(Object.keys(DAOEWO_ANALYTICS_PARAMETER_KEYS).sort()).toEqual(
      [...REQUIRED_EVENTS].sort(),
    );
  });

  it('이벤트별 허용 파라미터가 기획서와 일치한다', () => {
    expect(DAOEWO_ANALYTICS_PARAMETER_KEYS).toEqual({
      memo_deck_open: ['deck_id', 'tier', 'source'],
      memo_goal_set: ['mode', 'days', 'daily_count'],
      memo_session_start: ['deck_id', 'target_count'],
      memo_session_complete: ['known', 'unknown', 'elapsed_ms'],
      memo_review_outcome: ['outcome'],
      memo_catalog_browse: ['category'],
      memo_premium_deck_tap: ['deck_id'],
      memo_deck_request: ['category', 'locale'],
      memo_paywall_view: ['trigger'],
      memo_subscribe: ['plan', 'trial'],
      memo_streak_extend: ['streak_days'],
      memo_share: ['type'],
    });
  });

  it('자유 입력과 UID를 adapter 호출 전에 제거한다', async () => {
    const captured: Array<{
      event: DaoewoAnalyticsEventName;
      properties: Readonly<Record<string, DaoewoAnalyticsValue>>;
    }> = [];
    const analytics: DaoewoAnalytics = {
      async track<Event extends DaoewoAnalyticsEventName>(
        event: Event,
        properties: DaoewoAnalyticsEventMap[Event],
      ) {
        captured.push({
          event,
          properties: properties as Readonly<Record<string, DaoewoAnalyticsValue>>,
        });
      },
    };

    await trackDaoewoEvent(
      analytics,
      'memo_deck_request',
      {
        category: '자격증',
        locale: 'ko',
        topic: '관세법 자유 입력',
        note: '개인 메모',
        user_id: 'secret-uid',
      } as unknown as DaoewoAnalyticsEventMap['memo_deck_request'],
    );

    expect(captured).toEqual([
      {
        event: 'memo_deck_request',
        properties: {category: '자격증', locale: 'ko'},
      },
    ]);
  });
});
