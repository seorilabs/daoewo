import { createTimedCatalogCache } from '../src/catalog-cache';

describe('Remote Config catalog cache TTL', () => {
  it('재사용 시간 안에서는 값을 돌려주고 경과 후에는 network refresh를 요구한다', () => {
    let now = 1_000;
    let ttlMinutes = 5;
    const cache = createTimedCatalogCache<string>({
      getTtlMinutes: () => ttlMinutes,
      nowMs: () => now,
    });

    expect(cache.get()).toBeNull();
    expect(cache.set(['deck-a'])).toEqual(['deck-a']);
    now += 5 * 60_000;
    expect(cache.get()).toEqual(['deck-a']);
    now += 1;
    expect(cache.get()).toBeNull();

    ttlMinutes = 10;
    expect(cache.get()).toEqual(['deck-a']);
  });

  it('범위를 벗어나거나 읽기 실패한 TTL은 cache miss로 fail-closed한다', () => {
    let now = 1_000;
    let ttlMinutes: number | 'throw' = 0;
    const cache = createTimedCatalogCache<string>({
      getTtlMinutes: () => {
        if (ttlMinutes === 'throw') {
          throw new Error('remote config unavailable');
        }
        return ttlMinutes;
      },
      nowMs: () => now,
    });

    cache.set(['deck-a']);
    ttlMinutes = 0;
    expect(cache.get()).toBeNull();
    ttlMinutes = 5;
    expect(cache.get()).toBeNull();

    cache.set(['deck-b']);
    for (const invalidTtl of [4, 1_441, 5.5, Number.NaN]) {
      ttlMinutes = invalidTtl;
      expect(cache.get()).toBeNull();
      cache.set(['deck-b']);
    }
    ttlMinutes = 'throw';
    expect(cache.get()).toBeNull();

    ttlMinutes = 5;
    expect(cache.get()).toBeNull();
    cache.set(['deck-c']);
    now = 999;
    expect(cache.get()).toBeNull();
    now = 1_001;
    expect(cache.get()).toBeNull();

    now = 2_000;
    cache.set(['deck-d']);
    cache.clear();
    expect(cache.get()).toBeNull();
  });
});
