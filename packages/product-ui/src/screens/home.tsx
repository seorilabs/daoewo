import {useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import {
  AppText,
  Badge,
  BottomNavigation,
  PrimaryButton,
  ProgressBar,
  Screen,
  SectionHeading,
  SecondaryButton,
  Surface,
  TextButton,
  TopBar,
} from '../components';
import type {DaoewoDeckView} from '../demo-data';
import type {GoalMode, DaoewoScreen} from '../navigation';
import type {DaoewoDashboardSummary} from '../product-state';
import type {
  DaoewoAuthOption,
  DaoewoAuthProvider,
  DaoewoUser,
} from '../runtime';
import {useDaoewoTheme} from '../theme';

interface LogoMarkProps {
  readonly compact?: boolean;
}

export function LogoMark({compact = false}: LogoMarkProps) {
  const {colors} = useDaoewoTheme();
  const size = compact ? 46 : 82;
  const cardWidth = compact ? 28 : 48;
  const cardHeight = compact ? 35 : 60;

  return (
    <View
      accessibilityLabel="다외워 로고"
      style={[styles.logoMark, {height: size, width: size}]}>
      <View
        style={[
          styles.logoBackCard,
          {
            backgroundColor: colors.accentSoft,
            borderColor: colors.accent,
            height: cardHeight,
            width: cardWidth,
          },
        ]}
      />
      <View
        style={[
          styles.logoFrontCard,
          {
            backgroundColor: colors.accent,
            height: cardHeight,
            width: cardWidth,
          },
        ]}>
        <AppText style={[styles.logoCheck, {color: colors.accentText}]}>✓</AppText>
      </View>
    </View>
  );
}

interface OnboardingScreenProps {
  readonly authOptions: readonly DaoewoAuthOption[];
  readonly busyProvider: DaoewoAuthProvider | 'guest' | null;
  readonly error: string | null;
  readonly onSignIn: (provider: DaoewoAuthProvider) => void;
  readonly onContinueAsGuest: () => void;
}

export function OnboardingScreen({
  authOptions,
  busyProvider,
  error,
  onSignIn,
  onContinueAsGuest,
}: OnboardingScreenProps) {
  const {colors} = useDaoewoTheme();
  const busy = busyProvider !== null;

  return (
    <Screen accessibilityLabel="다외워 시작 화면">
      <View style={styles.onboardingHero}>
        <LogoMark />
        <AppText accessibilityRole="header" style={styles.brandName}>
          다외워
        </AppText>
        <AppText style={[styles.tagline, {color: colors.accent}]}>
          무엇이든 외운다
        </AppText>
        <AppText style={[styles.onboardingDescription, {color: colors.textMuted}]}>
          스와이프로 외우고, 틀린 건 다시 보고,{`\n`}필요한 덱은 계속 채워 드려요.
        </AppText>
      </View>

      <View style={styles.onboardingActions}>
        {authOptions.map((option, index) =>
          index === 0 ? (
            <PrimaryButton
              key={option.provider}
              label={
                busyProvider === option.provider ? '연결하는 중…' : option.label
              }
              onPress={() => onSignIn(option.provider)}
              disabled={busy}
              loading={busyProvider === option.provider}
              accessibilityHint={`${option.label.replace('로 계속하기', '')} 계정으로 다외워를 시작합니다`}
            />
          ) : (
            <SecondaryButton
              key={option.provider}
              label={
                busyProvider === option.provider ? '연결하는 중…' : option.label
              }
              onPress={() => onSignIn(option.provider)}
              disabled={busy}
              accessibilityHint={`${option.label.replace('로 계속하기', '')} 계정으로 다외워를 시작합니다`}
            />
          ),
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="로그인 없이 시작하기"
          accessibilityHint="이 기기에서 게스트로 다외워를 둘러봅니다"
          accessibilityState={{disabled: busy}}
          disabled={busy}
          onPress={onContinueAsGuest}
          style={({pressed}) => [
            styles.guestButton,
            pressed ? styles.pressed : undefined,
          ]}>
          {busyProvider === 'guest' ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <AppText style={[styles.guestButtonText, {color: colors.textMuted}]}>
              로그인 없이 시작하기 →
            </AppText>
          )}
        </Pressable>
        {error ? (
          <AppText
            accessibilityLiveRegion="assertive"
            style={[styles.authError, {color: colors.danger}]}>
            {error}
          </AppText>
        ) : null}
      </View>
      <AppText style={[styles.privacyCopy, {color: colors.textMuted}]}>
        계속하면 서비스 이용약관과 개인정보처리방침에 동의하게 됩니다.
      </AppText>
    </Screen>
  );
}

interface HomeScreenProps {
  readonly user: DaoewoUser;
  readonly isPro: boolean;
  readonly activeDecks: readonly DaoewoDeckView[];
  readonly navigate: (screen: DaoewoScreen) => void;
  readonly onSelectDeck: (deck: DaoewoDeckView) => void;
  readonly onContinueStudy: () => void;
  readonly notice?: string | null;
  readonly studyAvailable?: boolean;
  readonly summary: DaoewoDashboardSummary;
}

export function HomeScreen({
  user,
  isPro,
  activeDecks,
  navigate,
  onSelectDeck,
  onContinueStudy,
  notice,
  studyAvailable = true,
  summary,
}: HomeScreenProps) {
  const {colors} = useDaoewoTheme();
  const firstName = user.isGuest ? '게스트' : user.displayName;
  const todayRate =
    summary.todayTarget <= 0
      ? 0
      : Math.min(1, summary.todayCompleted / summary.todayTarget);
  const todayPercentage = Math.round(todayRate * 100);

  return (
    <Screen
      accessibilityLabel="다외워 홈 화면"
      footer={<BottomNavigation current="home" navigate={navigate} />}>
      <View style={styles.homeHeader}>
        <View style={styles.greetingCopy}>
          <AppText style={[styles.hello, {color: colors.textMuted}]}>안녕하세요</AppText>
          <AppText accessibilityRole="header" style={styles.greeting} numberOfLines={2}>
            {firstName}님 👋
          </AppText>
        </View>
        <View
          accessibilityLabel={`현재 스트릭 ${summary.streak.current}일`}
          style={[styles.streakPill, {backgroundColor: colors.warningSoft}]}>
          <AppText style={[styles.streakText, {color: colors.warning}]}>🔥 {summary.streak.current}일차</AppText>
        </View>
      </View>

      {notice ? (
        <View
          accessibilityLiveRegion="polite"
          style={[styles.noticeBanner, {backgroundColor: colors.warningSoft}]}>
          <AppText style={[styles.noticeText, {color: colors.warning}]}>
            {notice}
          </AppText>
        </View>
      ) : null}

      <Surface
        accessibilityLabel={
          studyAvailable
            ? `오늘 학습 ${summary.todayCompleted}장 완료, 목표 ${summary.todayTarget}장`
            : '학습 가능한 덱 준비 중'
        }>
        <View style={styles.todayHeading}>
          <View>
            <AppText style={[styles.eyebrow, {color: colors.accent}]}>오늘 학습</AppText>
            <AppText style={styles.todayCount}>
              {studyAvailable
                ? `${summary.todayCompleted} / ${summary.todayTarget}장`
                : '덱 준비 중'}
            </AppText>
          </View>
          <Badge
            label={studyAvailable ? `${todayPercentage}%` : '준비 중'}
            tone={studyAvailable ? 'accent' : 'warning'}
          />
        </View>
        <ProgressBar
          label={studyAvailable ? `오늘 학습 진행률 ${todayPercentage}퍼센트` : '학습 가능한 덱 준비 중'}
          value={studyAvailable ? todayRate : 0}
        />
        <View style={styles.homePrimaryAction}>
          <PrimaryButton
            label={studyAvailable ? '오늘 분량 이어하기' : '학습 가능한 덱 준비 중'}
            onPress={onContinueStudy}
            disabled={!studyAvailable}
            accessibilityHint="남은 오늘 카드 학습을 시작합니다"
            testID="continue-study"
          />
        </View>
      </Surface>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`복습 대기 ${summary.dueCount}장, 오답노트 열기`}
        accessibilityHint="간격 반복 복습 대기 목록으로 이동합니다"
        onPress={() => navigate('mistakes')}
        style={({pressed}) => [
          styles.reviewBanner,
          {backgroundColor: colors.warningSoft},
          pressed ? styles.pressed : undefined,
        ]}>
        <View style={styles.reviewBannerCopy}>
          <View style={[styles.reviewDot, {backgroundColor: colors.warning}]} />
          <AppText style={styles.reviewBannerTitle}>복습 대기</AppText>
          <AppText style={[styles.reviewBannerCount, {color: colors.warning}]}>
            {summary.dueCount}장
          </AppText>
        </View>
        <AppText style={[styles.chevron, {color: colors.warning}]}>›</AppText>
      </Pressable>

      <SectionHeading
        title="내 덱"
        detail={isPro ? '활성 덱을 제한 없이 학습 중이에요' : 'Free는 활성 덱 1개까지 가능해요'}
        action={<TextButton label="덱 탐색" onPress={() => navigate('catalog')} />}
      />
      <View style={styles.deckGrid}>
        {activeDecks.map(deck => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${deck.title}, 진행률 ${Math.round((deck.progress ?? 0) * 100)}퍼센트${deck.daysLeft ? `, ${deck.daysLeft}일 남음` : ''}`}
            accessibilityHint="덱 상세와 목표 설정을 엽니다"
            key={deck.id}
            onPress={() => onSelectDeck(deck)}
            style={({pressed}) => [
              styles.deckGridItem,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                shadowColor: colors.text,
              },
              pressed ? styles.deckPressed : undefined,
            ]}>
            <View style={styles.deckTopLine}>
              <Badge label={deck.locale} />
              {deck.tier === 'pro' ? <Badge label="Pro" tone="accent" /> : null}
            </View>
            <AppText style={styles.deckTitle} numberOfLines={2}>
              {deck.title}
            </AppText>
            {deck.daysLeft ? (
              <AppText style={[styles.daysLeft, {color: colors.textMuted}]}>
                D-{deck.daysLeft}
              </AppText>
            ) : null}
            <ProgressBar
              label={`${deck.title} 진행률`}
              value={deck.progress ?? 0}
              tone="success"
            />
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="새 덱 찾기"
          accessibilityHint="큐레이션 덱 카탈로그를 엽니다"
          onPress={() => navigate('catalog')}
          style={({pressed}) => [
            styles.findDeckItem,
            {borderColor: colors.border},
            pressed ? styles.deckPressed : undefined,
          ]}>
          <AppText style={[styles.findDeckPlus, {color: colors.accent}]}>＋</AppText>
          <AppText style={[styles.findDeckLabel, {color: colors.accent}]}>덱 찾기</AppText>
        </Pressable>
      </View>

      {!isPro ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Pro 혜택 보기"
          onPress={() => navigate('paywall')}
          style={({pressed}) => [
            styles.proBanner,
            {backgroundColor: colors.accentSoft},
            pressed ? styles.pressed : undefined,
          ]}>
          <LogoMark compact />
          <View style={styles.proBannerCopy}>
            <AppText style={styles.proBannerTitle}>더 많은 덱을 외우고 싶나요?</AppText>
            <AppText style={[styles.proBannerDescription, {color: colors.textMuted}]}>
              Pro에서 전 분야 큐레이션 덱을 만나세요.
            </AppText>
          </View>
          <AppText style={[styles.chevron, {color: colors.accent}]}>›</AppText>
        </Pressable>
      ) : null}
    </Screen>
  );
}

interface DeckDetailScreenProps {
  readonly deck: DaoewoDeckView;
  readonly now: Date;
  readonly onBack: () => void;
  readonly onStart: (mode: GoalMode, value: number) => void;
  readonly onRequestDeck: () => void;
  readonly goalBusy?: boolean;
  readonly goalError?: string | null;
}

export function DeckDetailScreen({
  deck,
  now,
  onBack,
  onStart,
  onRequestDeck,
  goalBusy = false,
  goalError,
}: DeckDetailScreenProps) {
  const {colors} = useDaoewoTheme();
  const [mode, setMode] = useState<GoalMode>('days');
  const [value, setValue] = useState(30);
  const unavailable =
    deck.availability === 'coming-soon' || deck.cardCount === null;
  const cardCountLabel =
    deck.cardCount === null
      ? '카드 준비 중'
      : `${deck.cardCount.toLocaleString('ko-KR')}장`;

  if (unavailable) {
    return (
      <Screen accessibilityLabel={`${deck.title} 준비 중 덱 상세 화면`}>
        <TopBar title="덱 상세" onBack={onBack} />
        <View style={styles.deckHero}>
          <View style={styles.deckHeroBadges}>
            <Badge label={deck.category} />
            <Badge
              label={deck.tier === 'pro' ? 'Pro' : 'Free'}
              tone={deck.tier === 'pro' ? 'accent' : 'success'}
            />
            <Badge label="준비 중" tone="warning" />
          </View>
          <AppText accessibilityRole="header" style={styles.deckHeroTitle}>
            {deck.title}
          </AppText>
          <AppText style={[styles.deckHeroMeta, {color: colors.textMuted}]}>
            {cardCountLabel} · {deck.locale}
          </AppText>
          <AppText style={[styles.deckHeroDescription, {color: colors.textMuted}]}>
            {deck.subtitle}
          </AppText>
        </View>
        <View style={[styles.comingSoonPanel, {backgroundColor: colors.warningSoft}]}>
          <AppText
            accessibilityRole="header"
            style={[styles.comingSoonTitle, {color: colors.warning}]}>
            검수 중인 큐레이션 덱이에요
          </AppText>
          <AppText style={[styles.comingSoonDescription, {color: colors.textMuted}]}>
            카드 본문과 분량이 승인되면 목표를 설정할 수 있어요. 덱 요청을 남기면 수요 확인에 반영됩니다.
          </AppText>
        </View>
        <PrimaryButton
          label="준비 중인 덱이에요"
          onPress={() => undefined}
          disabled
          accessibilityHint="카드 승인이 끝난 뒤 목표를 설정할 수 있습니다"
        />
        <View style={styles.comingSoonRequest}>
          <SecondaryButton label="이 덱 요청하기" onPress={onRequestDeck} />
        </View>
      </Screen>
    );
  }

  const cardCount = deck.cardCount;
  const days = mode === 'days' ? value : Math.ceil(cardCount / value);
  const dailyCount =
    mode === 'days' ? Math.max(1, Math.ceil(cardCount / value)) : value;
  const completionDate = new Date(now);
  completionDate.setDate(completionDate.getDate() + Math.max(0, days - 1));
  const completionLabel = `${completionDate.getMonth() + 1}/${completionDate.getDate()}`;

  const selectMode = (nextMode: GoalMode) => {
    setMode(nextMode);
    setValue(nextMode === 'days' ? 30 : 40);
  };
  const step = mode === 'days' ? 5 : 10;
  const minimum = mode === 'days' ? 5 : 10;
  const maximum = mode === 'days' ? 180 : 100;
  const decrement = () => setValue(current => Math.max(minimum, current - step));
  const increment = () => setValue(current => Math.min(maximum, current + step));

  return (
    <Screen accessibilityLabel={`${deck.title} 덱 상세와 목표 설정 화면`}>
      <TopBar title="목표 설정" onBack={onBack} />
      <View style={styles.deckHero}>
        <View style={styles.deckHeroBadges}>
          <Badge label={deck.category} />
          <Badge
            label={deck.tier === 'pro' ? 'Pro' : 'Free'}
            tone={deck.tier === 'pro' ? 'accent' : 'success'}
          />
        </View>
        <AppText accessibilityRole="header" style={styles.deckHeroTitle}>
          {deck.title}
        </AppText>
        <AppText style={[styles.deckHeroMeta, {color: colors.textMuted}]}>
          {cardCountLabel} · {deck.locale}
        </AppText>
        <AppText style={[styles.deckHeroDescription, {color: colors.textMuted}]}>
          {deck.subtitle}
        </AppText>
      </View>

      <View style={styles.goalSection}>
        <AppText accessibilityRole="header" style={styles.goalSectionTitle}>
          목표 방식
        </AppText>
        <View style={styles.goalModeRow}>
          {(
            [
              {key: 'days' as const, label: '기간으로'},
              {key: 'daily-count' as const, label: '분량으로'},
            ] as const
          ).map(item => {
            const selected = mode === item.key;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityLabel={item.label}
                accessibilityState={{selected}}
                key={item.key}
                onPress={() => selectMode(item.key)}
                style={({pressed}) => [
                  styles.goalModeButton,
                  {
                    backgroundColor: selected ? colors.accentSoft : colors.surface,
                    borderColor: selected ? colors.accent : colors.border,
                  },
                  pressed ? styles.pressed : undefined,
                ]}>
                <View
                  style={[
                    styles.radioDot,
                    {borderColor: selected ? colors.accent : colors.textMuted},
                  ]}>
                  {selected ? (
                    <View style={[styles.radioDotInner, {backgroundColor: colors.accent}]} />
                  ) : null}
                </View>
                <AppText
                  style={[
                    styles.goalModeLabel,
                    {color: selected ? colors.accent : colors.text},
                  ]}>
                  {item.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Surface style={styles.goalStepperSurface}>
        <AppText style={[styles.stepperQuestion, {color: colors.textMuted}]}>
          {mode === 'days' ? '며칠 안에 끝낼까요?' : '하루에 몇 장씩 외울까요?'}
        </AppText>
        <View style={styles.stepperRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${mode === 'days' ? '기간' : '하루 분량'} 줄이기`}
            accessibilityState={{disabled: value <= minimum}}
            disabled={value <= minimum}
            onPress={decrement}
            style={({pressed}) => [
              styles.stepperButton,
              {backgroundColor: colors.background},
              pressed ? styles.pressed : undefined,
              value <= minimum ? styles.dimmed : undefined,
            ]}>
            <AppText style={[styles.stepperSymbol, {color: colors.accent}]}>−</AppText>
          </Pressable>
          <View
            accessibilityLiveRegion="polite"
            accessibilityLabel={`${value}${mode === 'days' ? '일' : '장'}`}>
            <AppText style={styles.stepperValue}>{value}</AppText>
            <AppText style={[styles.stepperUnit, {color: colors.textMuted}]}>
              {mode === 'days' ? '일' : '장 / 하루'}
            </AppText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${mode === 'days' ? '기간' : '하루 분량'} 늘리기`}
            accessibilityState={{disabled: value >= maximum}}
            disabled={value >= maximum}
            onPress={increment}
            style={({pressed}) => [
              styles.stepperButton,
              {backgroundColor: colors.background},
              pressed ? styles.pressed : undefined,
              value >= maximum ? styles.dimmed : undefined,
            ]}>
            <AppText style={[styles.stepperSymbol, {color: colors.accent}]}>＋</AppText>
          </Pressable>
        </View>
      </Surface>

      <View style={[styles.preview, {backgroundColor: colors.accentSoft}]}>
        <View style={styles.previewHeading}>
          <AppText style={[styles.previewTitle, {color: colors.accent}]}>
            자동 배분 미리보기
          </AppText>
          <Badge label={`${days}일 계획`} tone="accent" />
        </View>
        <AppText style={styles.previewCount}>하루 약 {dailyCount}장</AppText>
        <AppText style={[styles.previewDate, {color: colors.textMuted}]}>
          쉬는 날 없이 학습하면 {completionLabel} 완료 예정
        </AppText>
        <View style={styles.previewProgress}>
          <ProgressBar label="목표 배분 미리보기" value={1} />
        </View>
      </View>

      <PrimaryButton
        label="이 목표로 시작하기"
        onPress={() => onStart(mode, value)}
        loading={goalBusy}
        accessibilityHint={`${deck.title} 덱의 일일 학습 계획을 만들고 첫 학습을 시작합니다`}
      />
      {goalError ? (
        <AppText
          accessibilityLiveRegion="assertive"
          style={[styles.goalError, {color: colors.danger}]}>
          {goalError}
        </AppText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pressed: {opacity: 0.75},
  dimmed: {opacity: 0.4},
  logoMark: {alignItems: 'center', justifyContent: 'center'},
  logoBackCard: {
    position: 'absolute',
    borderRadius: 12,
    borderWidth: 2,
    transform: [{rotate: '-12deg'}, {translateX: -5}],
  },
  logoFrontCard: {
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{rotate: '5deg'}, {translateX: 5}],
  },
  logoCheck: {fontSize: 26, lineHeight: 30, fontWeight: '800'},
  onboardingHero: {flex: 1, minHeight: 390, alignItems: 'center', justifyContent: 'center'},
  brandName: {fontSize: 38, lineHeight: 49, fontWeight: '800', marginTop: 20},
  tagline: {fontSize: 18, lineHeight: 26, fontWeight: '700', marginTop: 4},
  onboardingDescription: {fontSize: 16, lineHeight: 25, textAlign: 'center', marginTop: 24},
  onboardingActions: {gap: 12},
  guestButton: {minHeight: 46, alignItems: 'center', justifyContent: 'center'},
  guestButtonText: {fontSize: 15, lineHeight: 21, fontWeight: '600'},
  authError: {fontSize: 13, lineHeight: 20, textAlign: 'center', paddingHorizontal: 12},
  privacyCopy: {fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 18, paddingHorizontal: 20},
  homeHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 18, paddingBottom: 24},
  greetingCopy: {flex: 1, paddingRight: 12},
  hello: {fontSize: 14, lineHeight: 20},
  greeting: {fontSize: 27, lineHeight: 35, fontWeight: '800', marginTop: 2},
  noticeBanner: {borderRadius: 16, padding: 13, marginBottom: 14},
  noticeText: {fontSize: 12, lineHeight: 18, fontWeight: '600', textAlign: 'center'},
  streakPill: {borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9},
  streakText: {fontSize: 14, lineHeight: 19, fontWeight: '700'},
  todayHeading: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16},
  eyebrow: {fontSize: 14, lineHeight: 20, fontWeight: '700'},
  todayCount: {fontSize: 29, lineHeight: 37, fontWeight: '800', marginTop: 3},
  homePrimaryAction: {marginTop: 20},
  reviewBanner: {minHeight: 64, borderRadius: 20, marginTop: 16, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  reviewBannerCopy: {flexDirection: 'row', alignItems: 'center'},
  reviewDot: {width: 9, height: 9, borderRadius: 5, marginRight: 10},
  reviewBannerTitle: {fontSize: 16, lineHeight: 22, fontWeight: '700'},
  reviewBannerCount: {fontSize: 15, lineHeight: 21, fontWeight: '700', marginLeft: 8},
  chevron: {fontSize: 30, lineHeight: 32, fontWeight: '300'},
  deckGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 12},
  deckGridItem: {width: '48%', minHeight: 184, borderRadius: 22, borderWidth: 1, padding: 16, justifyContent: 'space-between', shadowOffset: {width: 0, height: 7}, shadowOpacity: 0.05, shadowRadius: 14, elevation: 1},
  deckPressed: {opacity: 0.78, transform: [{scale: 0.985}]},
  deckTopLine: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 4},
  deckTitle: {fontSize: 17, lineHeight: 23, fontWeight: '700', marginTop: 13},
  daysLeft: {fontSize: 13, lineHeight: 18, fontWeight: '600', marginVertical: 9},
  findDeckItem: {width: '48%', minHeight: 184, borderRadius: 22, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center'},
  findDeckPlus: {fontSize: 31, lineHeight: 36, fontWeight: '400'},
  findDeckLabel: {fontSize: 15, lineHeight: 21, fontWeight: '700', marginTop: 5},
  proBanner: {minHeight: 92, borderRadius: 22, marginTop: 28, padding: 16, flexDirection: 'row', alignItems: 'center'},
  proBannerCopy: {flex: 1, paddingHorizontal: 12},
  proBannerTitle: {fontSize: 15, lineHeight: 21, fontWeight: '700'},
  proBannerDescription: {fontSize: 12, lineHeight: 18, marginTop: 3},
  deckHero: {paddingVertical: 12, alignItems: 'center'},
  deckHeroBadges: {flexDirection: 'row', gap: 7},
  deckHeroTitle: {fontSize: 29, lineHeight: 38, fontWeight: '800', textAlign: 'center', marginTop: 18},
  deckHeroMeta: {fontSize: 14, lineHeight: 20, fontWeight: '600', marginTop: 7},
  deckHeroDescription: {fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 10},
  goalSection: {marginTop: 30},
  goalSectionTitle: {fontSize: 19, lineHeight: 26, fontWeight: '700', marginBottom: 12},
  goalModeRow: {flexDirection: 'row', gap: 10},
  goalModeButton: {flex: 1, minHeight: 55, borderRadius: 17, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9},
  radioDot: {width: 19, height: 19, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center'},
  radioDotInner: {width: 9, height: 9, borderRadius: 5},
  goalModeLabel: {fontSize: 15, lineHeight: 21, fontWeight: '700'},
  goalStepperSurface: {marginTop: 18, alignItems: 'center'},
  stepperQuestion: {fontSize: 14, lineHeight: 20},
  stepperRow: {width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18},
  stepperButton: {width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center'},
  stepperSymbol: {fontSize: 29, lineHeight: 34, fontWeight: '500'},
  stepperValue: {fontSize: 38, lineHeight: 46, fontWeight: '800', textAlign: 'center'},
  stepperUnit: {fontSize: 13, lineHeight: 18, fontWeight: '600', textAlign: 'center'},
  preview: {borderRadius: 22, padding: 20, marginVertical: 18},
  previewHeading: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  previewTitle: {fontSize: 14, lineHeight: 20, fontWeight: '700'},
  previewCount: {fontSize: 24, lineHeight: 32, fontWeight: '800', marginTop: 16},
  previewDate: {fontSize: 13, lineHeight: 19, marginTop: 3},
  previewProgress: {marginTop: 16},
  goalError: {fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 12},
  comingSoonPanel: {borderRadius: 22, padding: 20, marginVertical: 24},
  comingSoonTitle: {fontSize: 18, lineHeight: 25, fontWeight: '700'},
  comingSoonDescription: {fontSize: 14, lineHeight: 22, marginTop: 8},
  comingSoonRequest: {marginTop: 10},
});
