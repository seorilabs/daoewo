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
export declare function createDeliveryWindowDeckRegistry(): DeliveryWindowDeckRegistry;
//# sourceMappingURL=delivery-window.d.ts.map