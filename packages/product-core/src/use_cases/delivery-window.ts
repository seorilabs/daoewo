export interface DeliveryWindowDeckRegistry {
  /** 서버 응답 deckId가 요청과 일치할 때만 window를 권위 registry에 기록한다. */
  bind(input: {
    readonly requestedDeckId: string;
    readonly authoritativeDeckId: string;
    readonly windowId: string;
  }): void;
  /** commit caller가 window의 권위 deckId를 다른 tier/id로 바꿔 라우팅하지 못하게 한다. */
  assertBound(windowId: string, deckId: string): void;
}

export function createDeliveryWindowDeckRegistry(): DeliveryWindowDeckRegistry {
  const deckIdByWindowId = new Map<string, string>();
  return {
    bind(input) {
      const requestedDeckId = requireId(input.requestedDeckId, 'requestedDeckId');
      const authoritativeDeckId = requireId(
        input.authoritativeDeckId,
        'authoritativeDeckId',
      );
      const windowId = requireId(input.windowId, 'windowId');
      if (requestedDeckId !== authoritativeDeckId) {
        throw new Error('학습 덱 응답이 요청과 일치하지 않아요.');
      }
      deckIdByWindowId.set(windowId, authoritativeDeckId);
    },
    assertBound(windowIdInput, deckIdInput) {
      const windowId = requireId(windowIdInput, 'windowId');
      const deckId = requireId(deckIdInput, 'deckId');
      if (deckIdByWindowId.get(windowId) !== deckId) {
        throw new Error('학습 창의 권위 덱과 진도 요청이 일치하지 않아요.');
      }
    },
  };
}

function requireId(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new RangeError(`${field} is required`);
  }
  return normalized;
}
