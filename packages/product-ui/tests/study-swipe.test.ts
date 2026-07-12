import {
  SWIPE_CLASSIFICATION_THRESHOLD,
  swipeOutcomeFromDistance,
} from '../src/screens/study';

describe('학습 카드 스와이프 방향', () => {
  it('왼쪽 스와이프를 unknown으로 분류한다', () => {
    expect(swipeOutcomeFromDistance(-SWIPE_CLASSIFICATION_THRESHOLD)).toBe(
      'unknown',
    );
    expect(swipeOutcomeFromDistance(-180)).toBe('unknown');
  });

  it('오른쪽 스와이프를 known으로 분류한다', () => {
    expect(swipeOutcomeFromDistance(SWIPE_CLASSIFICATION_THRESHOLD)).toBe(
      'known',
    );
    expect(swipeOutcomeFromDistance(180)).toBe('known');
  });

  it('임계값 안쪽 이동은 카드를 원위치시킨다', () => {
    expect(swipeOutcomeFromDistance(-71)).toBeNull();
    expect(swipeOutcomeFromDistance(0)).toBeNull();
    expect(swipeOutcomeFromDistance(71)).toBeNull();
  });
});
