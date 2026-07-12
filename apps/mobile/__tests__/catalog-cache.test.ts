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

  it('범위를 벗어난 remote 값은 60분 fallback을 사용하고 clear는 즉시 폐기한다', () => {
    let now = 1_000;
    const cache = createTimedCatalogCache<string>({
      getTtlMinutes: () => 0,
      nowMs: () => now,
    });

    cache.set(['deck-a']);
    now += 60 * 60_000;
    expect(cache.get()).toEqual(['deck-a']);
    now += 1;
    expect(cache.get()).toBeNull();

    cache.set(['deck-b']);
    cache.clear();
    expect(cache.get()).toBeNull();
  });
});
