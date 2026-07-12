export function createDeliveryWindowDeckRegistry() {
    const deckIdByWindowId = new Map();
    return {
        bind(input) {
            const requestedDeckId = requireId(input.requestedDeckId, 'requestedDeckId');
            const authoritativeDeckId = requireId(input.authoritativeDeckId, 'authoritativeDeckId');
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
function requireId(value, field) {
    const normalized = value.trim();
    if (normalized.length === 0) {
        throw new RangeError(`${field} is required`);
    }
    return normalized;
}
//# sourceMappingURL=delivery-window.js.map