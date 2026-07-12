const MIN_TTL_MINUTES = 5;
const MAX_TTL_MINUTES = 24 * 60;

export interface TimedCatalogCache<Value> {
  get(): readonly Value[] | null;
  set(values: readonly Value[]): readonly Value[];
  clear(): void;
}

/**
 * Remote Config는 이미 받아 온 카탈로그의 재사용 시간만 조절한다. 권한, 덱 공개 상태,
 * Free/Pro 판정은 매 서버 응답과 entitlement 경계에서 별도로 검증한다.
 */
export function createTimedCatalogCache<Value>(input: {
  readonly getTtlMinutes: () => number;
  readonly nowMs?: () => number;
}): TimedCatalogCache<Value> {
  const nowMs = input.nowMs ?? Date.now;
  let values: readonly Value[] = [];
  let updatedAtMs = 0;

  return {
    get() {
      if (values.length === 0 || updatedAtMs <= 0) {
        return null;
      }
      const ttlMinutes = boundedTtlMinutes(input.getTtlMinutes());
      return nowMs() - updatedAtMs <= ttlMinutes * 60_000 ? values : null;
    },
    set(next) {
      values = [...next];
      updatedAtMs = nowMs();
      return values;
    },
    clear() {
      values = [];
      updatedAtMs = 0;
    },
  };
}

function boundedTtlMinutes(value: number): number {
  return Number.isSafeInteger(value) &&
    value >= MIN_TTL_MINUTES &&
    value <= MAX_TTL_MINUTES
    ? value
    : 60;
}
