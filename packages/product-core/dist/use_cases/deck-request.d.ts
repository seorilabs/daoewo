import type { DeckRequest, DeckRequestStatus } from '../domain/entities.js';
export declare const DECK_REQUEST_LIMITS: Readonly<{
    topicMinLength: 2;
    topicMaxLength: 80;
    categoryMaxLength: 40;
    noteMaxLength: 500;
}>;
export type DeckRequestValidationField = 'id' | 'topic' | 'category' | 'locale' | 'note' | 'status' | 'requesterId' | 'requestedAt';
export interface DeckRequestValidationIssue {
    readonly field: DeckRequestValidationField;
    readonly code: 'required' | 'too-short' | 'too-long' | 'invalid-format' | 'invalid-value';
    readonly message: string;
}
export type DeckRequestValidationResult = {
    readonly valid: true;
    readonly value: DeckRequest;
    readonly issues: readonly [];
} | {
    readonly valid: false;
    readonly issues: readonly DeckRequestValidationIssue[];
};
export interface DeckRequestContentInput {
    readonly topic?: string;
    readonly category?: string;
    readonly locale?: string;
    readonly note?: string;
}
export declare function validateDeckRequestContent(input: DeckRequestContentInput): readonly DeckRequestValidationIssue[];
export declare function validateDeckRequest(input: Partial<DeckRequest>): DeckRequestValidationResult;
export declare function createDeckRequest(input: Omit<DeckRequest, 'status' | 'requestedAt'> & {
    readonly status?: DeckRequestStatus;
    readonly requestedAt?: string;
}, now: Date): DeckRequest;
export declare class DeckRequestValidationError extends Error {
    readonly issues: readonly DeckRequestValidationIssue[];
    constructor(issues: readonly DeckRequestValidationIssue[]);
}
//# sourceMappingURL=deck-request.d.ts.map