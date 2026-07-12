export const DECK_REQUEST_LIMITS = Object.freeze({
    topicMinLength: 2,
    topicMaxLength: 80,
    categoryMaxLength: 40,
    noteMaxLength: 500,
});
export function validateDeckRequestContent(input) {
    const issues = [];
    const topic = input.topic?.trim() ?? '';
    const category = input.category?.trim() ?? '';
    const locale = input.locale?.trim() ?? '';
    const note = input.note?.trim() ?? '';
    if (topic.length === 0) {
        issues.push(issue('topic', 'required', '주제를 입력해 주세요.'));
    }
    else if (topic.length < DECK_REQUEST_LIMITS.topicMinLength) {
        issues.push(issue('topic', 'too-short', `주제는 ${DECK_REQUEST_LIMITS.topicMinLength}자 이상이어야 합니다.`));
    }
    else if (topic.length > DECK_REQUEST_LIMITS.topicMaxLength) {
        issues.push(issue('topic', 'too-long', `주제는 ${DECK_REQUEST_LIMITS.topicMaxLength}자 이하여야 합니다.`));
    }
    if (category.length === 0) {
        issues.push(issue('category', 'required', '카테고리를 입력해 주세요.'));
    }
    else if (category.length > DECK_REQUEST_LIMITS.categoryMaxLength) {
        issues.push(issue('category', 'too-long', `카테고리는 ${DECK_REQUEST_LIMITS.categoryMaxLength}자 이하여야 합니다.`));
    }
    if (locale.length === 0) {
        issues.push(issue('locale', 'required', '언어 코드를 입력해 주세요.'));
    }
    else if (!isLocale(locale)) {
        issues.push(issue('locale', 'invalid-format', '언어 코드는 ko 또는 en-US 같은 형식이어야 합니다.'));
    }
    if (note.length > DECK_REQUEST_LIMITS.noteMaxLength) {
        issues.push(issue('note', 'too-long', `요청 메모는 ${DECK_REQUEST_LIMITS.noteMaxLength}자 이하여야 합니다.`));
    }
    return issues;
}
export function validateDeckRequest(input) {
    const issues = [...validateDeckRequestContent(input)];
    const id = input.id?.trim() ?? '';
    const requesterId = input.requesterId?.trim() ?? '';
    const status = input.status;
    const requestedAt = input.requestedAt?.trim() ?? '';
    if (id.length === 0) {
        issues.push(issue('id', 'required', '요청 ID가 필요합니다.'));
    }
    if (requesterId.length === 0) {
        issues.push(issue('requesterId', 'required', '요청자 ID가 필요합니다.'));
    }
    if (!isDeckRequestStatus(status)) {
        issues.push(issue('status', 'invalid-value', '지원하지 않는 요청 상태입니다.'));
    }
    if (requestedAt.length === 0) {
        issues.push(issue('requestedAt', 'required', '요청 시각이 필요합니다.'));
    }
    else if (!Number.isFinite(Date.parse(requestedAt))) {
        issues.push(issue('requestedAt', 'invalid-format', '요청 시각은 ISO 날짜 형식이어야 합니다.'));
    }
    if (issues.length > 0 || status == null) {
        return { valid: false, issues };
    }
    const note = input.note?.trim();
    const value = {
        id,
        topic: input.topic?.trim() ?? '',
        category: input.category?.trim() ?? '',
        locale: input.locale?.trim() ?? '',
        status,
        requesterId,
        requestedAt: new Date(requestedAt).toISOString(),
        ...(note == null || note.length === 0 ? {} : { note }),
    };
    return { valid: true, value, issues: [] };
}
export function createDeckRequest(input, now) {
    const candidate = {
        ...input,
        status: input.status ?? 'queued',
        requestedAt: input.requestedAt ?? now.toISOString(),
    };
    const result = validateDeckRequest(candidate);
    if (!result.valid) {
        throw new DeckRequestValidationError(result.issues);
    }
    return result.value;
}
export class DeckRequestValidationError extends Error {
    issues;
    constructor(issues) {
        super('Invalid deck request');
        this.name = 'DeckRequestValidationError';
        this.issues = issues;
    }
}
function issue(field, code, message) {
    return { field, code, message };
}
function isLocale(value) {
    return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value);
}
function isDeckRequestStatus(value) {
    return value === 'queued' || value === 'generating' || value === 'published' || value === 'rejected';
}
//# sourceMappingURL=deck-request.js.map