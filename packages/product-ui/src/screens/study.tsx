import {useCallback, useMemo, useRef, useState} from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import {
  AppText,
  Badge,
  EmptyState,
  PrimaryButton,
  ProgressBar,
  Screen,
  SecondaryButton,
  TextButton,
  TopBar,
} from '../components';
import type {DaoewoCardView} from '../demo-data';
import type {ReviewRating} from '../navigation';
import type {
  DaoewoMistakeItem,
  DaoewoWeaknessTag,
} from '../product-state';
import {useDaoewoTheme} from '../theme';

export type SwipeOutcome = 'known' | 'unknown';

export const SWIPE_CLASSIFICATION_THRESHOLD = 72;

/** 음수 dx(왼쪽)는 unknown, 양수 dx(오른쪽)는 known으로 고정한다. */
export function swipeOutcomeFromDistance(dx: number): SwipeOutcome | null {
  if (dx <= -SWIPE_CLASSIFICATION_THRESHOLD) {
    return 'unknown';
  }
  if (dx >= SWIPE_CLASSIFICATION_THRESHOLD) {
    return 'known';
  }
  return null;
}

interface StudyScreenProps {
  readonly cards: readonly DaoewoCardView[];
  readonly ttsEnabled: boolean;
  readonly onClose: () => void;
  readonly onAnswer: (card: DaoewoCardView, outcome: SwipeOutcome) => void;
  readonly onComplete: (unknownCards: readonly DaoewoCardView[]) => void;
  readonly onSpeak: (card: DaoewoCardView) => void;
}

export function StudyScreen({
  cards,
  ttsEnabled,
  onClose,
  onAnswer,
  onComplete,
  onSpeak,
}: StudyScreenProps) {
  const {colors} = useDaoewoTheme();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [unknownCards, setUnknownCards] = useState<readonly DaoewoCardView[]>([]);
  const [showHint, setShowHint] = useState(false);
  const [bookmarked, setBookmarked] = useState<ReadonlySet<string>>(new Set());
  const pan = useRef(new Animated.ValueXY()).current;
  const currentCard = cards[currentIndex];

  const answer = useCallback(
    (outcome: SwipeOutcome) => {
      const card = cards[currentIndex];
      if (!card) {
        return;
      }

      const nextUnknown =
        outcome === 'unknown' ? [...unknownCards, card] : unknownCards;
      onAnswer(card, outcome);
      pan.setValue({x: 0, y: 0});
      setShowHint(false);

      if (currentIndex >= cards.length - 1) {
        onComplete(nextUnknown);
        return;
      }

      setUnknownCards(nextUnknown);
      setCurrentIndex(index => index + 1);
    },
    [cards, currentIndex, onAnswer, onComplete, pan, unknownCards],
  );

  const animateAnswer = useCallback(
    (outcome: SwipeOutcome) => {
      const toValue = outcome === 'known' ? 440 : -440;
      Animated.timing(pan, {
        toValue: {x: toValue, y: 10},
        duration: 170,
        useNativeDriver: true,
      }).start(() => answer(outcome));
    },
    [answer, pan],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: Animated.event([null, {dx: pan.x, dy: pan.y}], {
          useNativeDriver: false,
        }),
        onPanResponderRelease: (_, gesture) => {
          const outcome = swipeOutcomeFromDistance(gesture.dx);
          if (outcome !== null) {
            animateAnswer(outcome);
          } else {
            Animated.spring(pan, {
              toValue: {x: 0, y: 0},
              useNativeDriver: true,
              speed: 18,
              bounciness: 5,
            }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(pan, {
            toValue: {x: 0, y: 0},
            useNativeDriver: true,
          }).start();
        },
      }),
    [animateAnswer, pan],
  );

  const rotate = pan.x.interpolate({
    inputRange: [-300, 0, 300],
    outputRange: ['-7deg', '0deg', '7deg'],
    extrapolate: 'clamp',
  });
  const unknownOpacity = pan.x.interpolate({
    inputRange: [-90, -20, 0],
    outputRange: [1, 0, 0],
    extrapolate: 'clamp',
  });
  const knownOpacity = pan.x.interpolate({
    inputRange: [0, 20, 90],
    outputRange: [0, 0, 1],
    extrapolate: 'clamp',
  });

  if (!currentCard) {
    return (
      <Screen scroll={false}>
        <TopBar title="오늘 학습" onBack={onClose} backLabel="학습 닫기" />
        <EmptyState
          title="오늘 카드를 모두 외웠어요"
          description="내일 분량과 복습 카드는 자동으로 준비됩니다."
        />
        <PrimaryButton label="홈으로 돌아가기" onPress={onClose} />
      </Screen>
    );
  }

  const isBookmarked = bookmarked.has(currentCard.id);
  const toggleBookmark = () => {
    setBookmarked(previous => {
      const next = new Set(previous);
      if (next.has(currentCard.id)) {
        next.delete(currentCard.id);
      } else {
        next.add(currentCard.id);
      }
      return next;
    });
  };

  return (
    <Screen accessibilityLabel="스와이프 학습 화면">
      <View style={styles.studyHeader}>
        <TextButton
          label="학습 닫기"
          onPress={onClose}
          accessibilityHint="학습을 멈추고 홈으로 돌아갑니다"
          tone="muted"
        />
        <AppText style={[styles.counter, {color: colors.textMuted}]}>
          {currentIndex + 1} / {cards.length}
        </AppText>
      </View>
      <ProgressBar
        label={`오늘 학습 ${currentIndex + 1}장째, 전체 ${cards.length}장`}
        value={(currentIndex + 1) / cards.length}
      />

      <View style={styles.cardStage}>
        <Animated.View
          accessible
          accessibilityActions={[
            {name: 'decrement', label: '모르겠다'},
            {name: 'increment', label: '안다'},
          ]}
          accessibilityHint="왼쪽으로 밀면 모르겠다, 오른쪽으로 밀면 안다로 분류합니다"
          accessibilityLabel={`${currentCard.front}${currentCard.reading ? `, ${currentCard.reading}` : ''}`}
          onAccessibilityAction={event => {
            if (event.nativeEvent.actionName === 'decrement') {
              animateAnswer('unknown');
            } else if (event.nativeEvent.actionName === 'increment') {
              animateAnswer('known');
            }
          }}
          style={[
            styles.studyCard,
            {
              backgroundColor: colors.surfaceRaised,
              borderColor: colors.border,
              shadowColor: colors.text,
              transform: [...pan.getTranslateTransform(), {rotate}],
            },
          ]}
          {...panResponder.panHandlers}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.swipeStamp,
              styles.unknownStamp,
              {borderColor: colors.danger, opacity: unknownOpacity},
            ]}>
            <AppText style={[styles.stampText, {color: colors.danger}]}>
              모르겠다
            </AppText>
          </Animated.View>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.swipeStamp,
              styles.knownStamp,
              {borderColor: colors.success, opacity: knownOpacity},
            ]}>
            <AppText style={[styles.stampText, {color: colors.success}]}>
              안다
            </AppText>
          </Animated.View>

          <Badge label={currentCard.tags[0] ?? '오늘 카드'} tone="accent" />
          <View style={styles.cardCopy}>
            <AppText accessibilityRole="header" style={styles.cardFront}>
              {currentCard.front}
            </AppText>
            {currentCard.reading ? (
              <AppText style={[styles.cardReading, {color: colors.textMuted}]}>
                {currentCard.reading}
              </AppText>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showHint ? '힌트 닫기' : '힌트와 예문 보기'}
            accessibilityState={{expanded: showHint}}
            onPress={() => setShowHint(value => !value)}
            style={({pressed}) => [
              styles.hintButton,
              {backgroundColor: colors.background},
              pressed ? styles.pressed : undefined,
            ]}>
            <AppText style={[styles.hintButtonText, {color: colors.accent}]}>
              {showHint ? '힌트 닫기 ︿' : '힌트 · 예문 보기 ﹀'}
            </AppText>
          </Pressable>
          {showHint ? (
            <View
              accessibilityLiveRegion="polite"
              style={[styles.hintPanel, {borderTopColor: colors.border}]}>
              <AppText style={[styles.hintText, {color: colors.textMuted}]}>
                {currentCard.hint}
              </AppText>
              {currentCard.example ? (
                <AppText style={styles.exampleText}>{currentCard.example}</AppText>
              ) : null}
            </View>
          ) : null}
        </Animated.View>
      </View>

      <View style={styles.answerRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="모르겠다"
          accessibilityHint="이 카드를 즉시 복습 목록에 추가합니다"
          onPress={() => animateAnswer('unknown')}
          style={({pressed}) => [
            styles.answerButton,
            {backgroundColor: colors.dangerSoft, borderColor: colors.danger},
            pressed ? styles.pressed : undefined,
          ]}>
          <AppText style={[styles.answerArrow, {color: colors.danger}]}>←</AppText>
          <AppText style={[styles.answerText, {color: colors.danger}]}>
            모르겠다
          </AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="안다"
          accessibilityHint="이 카드를 알고 있음으로 분류합니다"
          onPress={() => animateAnswer('known')}
          style={({pressed}) => [
            styles.answerButton,
            {backgroundColor: colors.successSoft, borderColor: colors.success},
            pressed ? styles.pressed : undefined,
          ]}>
          <AppText style={[styles.answerText, {color: colors.success}]}>안다</AppText>
          <AppText style={[styles.answerArrow, {color: colors.success}]}>→</AppText>
        </Pressable>
      </View>

      <View style={styles.utilityRow}>
        <TextButton
          label={isBookmarked ? '♥ 북마크됨' : '♡ 북마크'}
          onPress={toggleBookmark}
          tone={isBookmarked ? 'accent' : 'muted'}
        />
        <TextButton
          label={ttsEnabled ? '◖ 발음 듣기' : '카드 음성 꺼짐'}
          disabled={!ttsEnabled}
          onPress={() => onSpeak(currentCard)}
          accessibilityHint="카드 앞면을 음성으로 듣습니다"
          tone="muted"
        />
      </View>
    </Screen>
  );
}

interface QuickReviewScreenProps {
  readonly cards: readonly DaoewoCardView[];
  readonly ttsEnabled: boolean;
  readonly onClose: () => void;
  readonly onRate: (card: DaoewoCardView, rating: ReviewRating) => void;
  readonly onComplete: () => void;
  readonly onSpeak: (card: DaoewoCardView) => void;
}

const ratingCopy: Readonly<
  Record<ReviewRating, {label: string; next: string; tone: 'success' | 'warning' | 'danger'}>
> = {
  easy: {label: '맞췄다', next: '1일 후', tone: 'success'},
  confused: {label: '헷갈린다', next: '1시간 후', tone: 'warning'},
  missed: {label: '몰랐다', next: '잠시 후', tone: 'danger'},
};

export function QuickReviewScreen({
  cards,
  ttsEnabled,
  onClose,
  onRate,
  onComplete,
  onSpeak,
}: QuickReviewScreenProps) {
  const {colors} = useDaoewoTheme();
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = cards[index];

  if (!card) {
    return (
      <Screen scroll={false}>
        <TopBar title="오답 복습" onBack={onClose} backLabel="복습 닫기" />
        <View style={styles.reviewComplete}>
          <EmptyState
            title="복습까지 마쳤어요"
            description="헷갈린 카드는 적절한 시점에 다시 보여 드릴게요."
          />
          <PrimaryButton label="오늘 학습 마치기" onPress={onComplete} />
        </View>
      </Screen>
    );
  }

  const rate = (rating: ReviewRating) => {
    onRate(card, rating);
    setFlipped(false);
    setIndex(value => value + 1);
  };

  return (
    <Screen accessibilityLabel="즉시 오답 복습 화면">
      <TopBar
        title="오답 복습"
        onBack={onClose}
        backLabel="복습 닫기"
        trailing={
          <AppText style={[styles.reviewCounter, {color: colors.textMuted}]}>
            {index + 1}/{cards.length}
          </AppText>
        }
      />
      <ProgressBar
        label={`오답 복습 ${index + 1}장째, 전체 ${cards.length}장`}
        value={(index + 1) / cards.length}
        tone="warning"
      />

      <View style={styles.reviewStage}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            flipped
              ? `${card.front}, 정답 ${card.back}`
              : `${card.front}, 탭하여 정답 보기`
          }
          accessibilityHint={flipped ? '카드를 다시 뒤집습니다' : '정답과 예문을 확인합니다'}
          accessibilityState={{expanded: flipped}}
          onPress={() => setFlipped(value => !value)}
          style={({pressed}) => [
            styles.reviewCard,
            {
              backgroundColor: colors.surfaceRaised,
              borderColor: flipped ? colors.accent : colors.border,
              shadowColor: colors.text,
            },
            pressed ? styles.reviewCardPressed : undefined,
          ]}>
          <Badge label={flipped ? '정답' : '문제'} tone={flipped ? 'success' : 'accent'} />
          <AppText accessibilityRole="header" style={styles.reviewFront}>
            {card.front}
          </AppText>
          {card.reading ? (
            <AppText style={[styles.reviewReading, {color: colors.textMuted}]}>
              {card.reading}
            </AppText>
          ) : null}
          <View style={[styles.flipDivider, {backgroundColor: colors.border}]} />
          {flipped ? (
            <View accessibilityLiveRegion="polite" style={styles.answerCopy}>
              <AppText style={styles.reviewBack}>{card.back}</AppText>
              {card.example ? (
                <AppText style={[styles.reviewExample, {color: colors.textMuted}]}>
                  {card.example}
                </AppText>
              ) : null}
              {card.exampleMeaning ? (
                <AppText style={[styles.reviewMeaning, {color: colors.textMuted}]}>
                  {card.exampleMeaning}
                </AppText>
              ) : null}
            </View>
          ) : (
            <AppText style={[styles.tapToFlip, {color: colors.textMuted}]}>
              탭하여 뒤집기
            </AppText>
          )}
        </Pressable>
      </View>

      <TextButton
        label={ttsEnabled ? '◖ 발음 듣기' : '카드 음성 꺼짐'}
        disabled={!ttsEnabled}
        onPress={() => onSpeak(card)}
        accessibilityHint="카드 앞면을 음성으로 듣습니다"
        tone="muted"
      />
      <View style={styles.ratingRow}>
        {(Object.keys(ratingCopy) as ReviewRating[]).map(rating => {
          const copy = ratingCopy[rating];
          const toneColor =
            copy.tone === 'success'
              ? colors.success
              : copy.tone === 'warning'
                ? colors.warning
                : colors.danger;
          const softColor =
            copy.tone === 'success'
              ? colors.successSoft
              : copy.tone === 'warning'
                ? colors.warningSoft
                : colors.dangerSoft;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${copy.label}, 다음 복습 ${copy.next}`}
              accessibilityHint={
                flipped ? '이 평가를 저장하고 다음 카드로 이동합니다' : '먼저 카드를 뒤집어 주세요'
              }
              accessibilityState={{disabled: !flipped}}
              disabled={!flipped}
              key={rating}
              onPress={() => rate(rating)}
              style={({pressed}) => [
                styles.ratingButton,
                {backgroundColor: softColor, borderColor: toneColor},
                pressed ? styles.pressed : undefined,
                !flipped ? styles.disabled : undefined,
              ]}>
              <AppText style={[styles.ratingLabel, {color: toneColor}]}>
                {copy.label}
              </AppText>
              <AppText style={[styles.ratingNext, {color: toneColor}]}>
                {copy.next}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}

interface MistakesScreenProps {
  readonly items: readonly DaoewoMistakeItem[];
  readonly weaknessTags: readonly DaoewoWeaknessTag[];
  readonly now: Date;
  readonly isPro: boolean;
  readonly onBack: () => void;
  readonly onStartReview: () => void;
  readonly onOpenPaywall: () => void;
}

export function MistakesScreen({
  items,
  weaknessTags,
  now,
  isPro,
  onBack,
  onStartReview,
  onOpenPaywall,
}: MistakesScreenProps) {
  const {colors} = useDaoewoTheme();
  const dueCount = items.filter(item => item.isDue).length;
  const nextFutureReview = items.find(item => {
    const due = item.dueAt === null ? Number.NaN : Date.parse(item.dueAt);
    return Number.isFinite(due) && due > now.getTime();
  });

  return (
    <Screen accessibilityLabel="오답노트 화면">
      <TopBar title="오답노트" onBack={onBack} />
      <View style={[styles.dueSummary, {backgroundColor: colors.warningSoft}]}>
        <View>
          <AppText style={[styles.eyebrow, {color: colors.warning}]}>
            지금 복습 가능
          </AppText>
          <AppText accessibilityRole="header" style={styles.dueCount}>
            {dueCount}장
          </AppText>
        </View>
        <Badge label="SRS 복습" tone="warning" />
      </View>
      <PrimaryButton
        label="지금 복습 시작하기"
        onPress={onStartReview}
        disabled={dueCount === 0}
        accessibilityHint="복습이 필요한 카드부터 시작합니다"
      />

      <View style={styles.mistakeSection}>
        <AppText accessibilityRole="header" style={styles.mistakeSectionTitle}>
          예정된 복습
        </AppText>
        {items.length === 0 ? (
          <EmptyState
            title="복습할 오답이 없어요"
            description="모르겠다고 분류하거나 복습에서 놓친 카드가 여기에 저장됩니다."
          />
        ) : (
          items.map(item => {
            const due = formatReviewDue(item, now);
            return (
              <View
                accessibilityLabel={`${item.card.front}, ${due}`}
                key={`${item.card.deckId}:${item.card.id}`}
                style={[styles.scheduleRow, {borderBottomColor: colors.border}]}>
                <View style={styles.scheduleCopy}>
                  <AppText style={styles.scheduleFront}>{item.card.front}</AppText>
                  <AppText style={[styles.scheduleBack, {color: colors.textMuted}]}>
                    {item.card.back}
                  </AppText>
                </View>
                <AppText style={[styles.scheduleDue, {color: colors.warning}]}>
                  {due}
                </AppText>
              </View>
            );
          })
        )}
        {nextFutureReview ? (
          <View style={[styles.countdown, {backgroundColor: colors.surface}]}>
            <AppText style={[styles.countdownText, {color: colors.textMuted}]}>
              다음 복습까지 {formatReviewDue(nextFutureReview, now)}
            </AppText>
          </View>
        ) : null}
      </View>

      <View style={[styles.weakTags, {borderColor: colors.border}]}>
        <View style={styles.weakTagsHeading}>
          <AppText accessibilityRole="header" style={styles.weakTagsTitle}>
            약점 태그
          </AppText>
          {!isPro ? <Badge label="Pro" tone="accent" /> : null}
        </View>
        {isPro ? (
          weaknessTags.length > 0 ? (
            <View style={styles.weakTagsList}>
              {weaknessTags.map(tag => (
                <Badge
                  key={tag.label}
                  label={`#${tag.label} ${tag.rate}%`}
                  tone={tag.rate >= 60 ? 'danger' : 'warning'}
                />
              ))}
            </View>
          ) : (
            <AppText style={{color: colors.textMuted}}>
              학습 기록이 쌓이면 약점 태그를 계산해 드려요.
            </AppText>
          )
        ) : (
          <SecondaryButton
            label="약점 집중 복습 알아보기"
            onPress={onOpenPaywall}
          />
        )}
      </View>
    </Screen>
  );
}

function formatReviewDue(item: DaoewoMistakeItem, now: Date): string {
  if (item.isDue) {
    return '지금';
  }
  if (item.dueAt === null) {
    return '복습 필요';
  }
  const dueAt = Date.parse(item.dueAt);
  if (!Number.isFinite(dueAt) || dueAt <= now.getTime()) {
    return '지금';
  }
  const minutes = Math.ceil((dueAt - now.getTime()) / 60_000);
  if (minutes < 60) {
    return `${minutes}분 후`;
  }
  if (minutes < 24 * 60) {
    return `${Math.ceil(minutes / 60)}시간 후`;
  }
  return `${Math.ceil(minutes / (24 * 60))}일 후`;
}

const styles = StyleSheet.create({
  pressed: {opacity: 0.75},
  disabled: {opacity: 0.42},
  studyHeader: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  counter: {fontSize: 15, lineHeight: 21, fontWeight: '700'},
  cardStage: {flex: 1, justifyContent: 'center', paddingVertical: 18},
  studyCard: {
    minHeight: 390,
    width: '100%',
    borderRadius: 30,
    borderWidth: 1,
    padding: 24,
    justifyContent: 'space-between',
    shadowOffset: {width: 0, height: 16},
    shadowOpacity: 0.12,
    shadowRadius: 28,
    elevation: 5,
  },
  swipeStamp: {
    position: 'absolute',
    top: 28,
    borderWidth: 3,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    transform: [{rotate: '-6deg'}],
    zIndex: 3,
  },
  unknownStamp: {right: 24},
  knownStamp: {left: 24, transform: [{rotate: '6deg'}]},
  stampText: {fontSize: 16, lineHeight: 22, fontWeight: '800'},
  cardCopy: {alignItems: 'center', justifyContent: 'center', flex: 1, paddingVertical: 42},
  cardFront: {fontSize: 38, lineHeight: 50, fontWeight: '800', textAlign: 'center'},
  cardReading: {fontSize: 20, lineHeight: 28, marginTop: 10, textAlign: 'center'},
  hintButton: {alignSelf: 'center', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10},
  hintButtonText: {fontSize: 14, lineHeight: 20, fontWeight: '700'},
  hintPanel: {borderTopWidth: 1, marginTop: 16, paddingTop: 14},
  hintText: {fontSize: 14, lineHeight: 21, textAlign: 'center'},
  exampleText: {fontSize: 15, lineHeight: 23, textAlign: 'center', marginTop: 7},
  answerRow: {flexDirection: 'row', gap: 12},
  answerButton: {
    flex: 1,
    minHeight: 58,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  answerArrow: {fontSize: 24, lineHeight: 28, fontWeight: '500'},
  answerText: {fontSize: 16, lineHeight: 22, fontWeight: '700'},
  utilityRow: {flexDirection: 'row', justifyContent: 'center', gap: 18, paddingTop: 8},
  reviewCounter: {fontSize: 14, lineHeight: 20, fontWeight: '700'},
  reviewStage: {flex: 1, justifyContent: 'center', paddingVertical: 22},
  reviewCard: {
    width: '100%',
    minHeight: 390,
    borderRadius: 30,
    borderWidth: 1,
    padding: 26,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: {width: 0, height: 14},
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 4,
  },
  reviewCardPressed: {transform: [{scale: 0.992}]},
  reviewFront: {fontSize: 34, lineHeight: 45, fontWeight: '800', textAlign: 'center', marginTop: 28},
  reviewReading: {fontSize: 18, lineHeight: 25, marginTop: 6, textAlign: 'center'},
  flipDivider: {height: 1, width: '64%', marginVertical: 28},
  answerCopy: {alignItems: 'center'},
  reviewBack: {fontSize: 25, lineHeight: 34, fontWeight: '700', textAlign: 'center'},
  reviewExample: {fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 18},
  reviewMeaning: {fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 3},
  tapToFlip: {fontSize: 14, lineHeight: 20, fontWeight: '600'},
  ratingRow: {flexDirection: 'row', gap: 8, paddingTop: 8},
  ratingButton: {
    flex: 1,
    minHeight: 70,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  ratingLabel: {fontSize: 14, lineHeight: 19, fontWeight: '700', textAlign: 'center'},
  ratingNext: {fontSize: 11, lineHeight: 16, fontWeight: '600', marginTop: 3},
  reviewComplete: {flex: 1, justifyContent: 'center', paddingBottom: 40},
  dueSummary: {
    borderRadius: 24,
    padding: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  eyebrow: {fontSize: 14, lineHeight: 20, fontWeight: '700'},
  dueCount: {fontSize: 32, lineHeight: 40, fontWeight: '800', marginTop: 4},
  mistakeSection: {marginTop: 32},
  mistakeSectionTitle: {fontSize: 20, lineHeight: 27, fontWeight: '700', marginBottom: 10},
  scheduleRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
  },
  scheduleCopy: {flex: 1},
  scheduleFront: {fontSize: 17, lineHeight: 23, fontWeight: '700'},
  scheduleBack: {fontSize: 13, lineHeight: 19, marginTop: 2},
  scheduleDue: {fontSize: 13, lineHeight: 19, fontWeight: '700', marginLeft: 12},
  countdown: {borderRadius: 14, alignItems: 'center', padding: 13, marginTop: 14},
  countdownText: {fontSize: 13, lineHeight: 19, fontWeight: '600'},
  weakTags: {borderWidth: 1, borderRadius: 22, padding: 18, marginTop: 28, gap: 14},
  weakTagsHeading: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  weakTagsTitle: {fontSize: 17, lineHeight: 23, fontWeight: '700'},
  weakTagsList: {flexDirection: 'row', flexWrap: 'wrap', gap: 7},
});
