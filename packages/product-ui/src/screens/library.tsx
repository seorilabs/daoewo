import {useEffect, useMemo, useState} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {
  hasActiveProEntitlement,
  validateDeckRequestContent,
} from '@daoewo/product-core';

import {
  AppText,
  Badge,
  BottomNavigation,
  Chip,
  EmptyState,
  PrimaryButton,
  ProgressBar,
  Screen,
  SecondaryButton,
  Surface,
  TopBar,
} from '../components';
import {filterDaoewoCatalog} from '../core-adapter';
import type {
  DaoewoDeckCategory,
  DaoewoDeckTier,
  DaoewoDeckView,
} from '../demo-data';
import type {DaoewoScreen} from '../navigation';
import type {DaoewoDashboardSummary} from '../product-state';
import type {DaoewoEntitlementState} from '../runtime';
import {useDaoewoTheme} from '../theme';

type CategoryFilter = '전체' | DaoewoDeckCategory;
type TierFilter = 'all' | DaoewoDeckTier;

interface CatalogScreenProps {
  readonly decks: readonly DaoewoDeckView[];
  readonly entitlement: DaoewoEntitlementState;
  readonly now: Date;
  readonly onBack: () => void;
  readonly onBrowseCategory: (category: string) => void;
  readonly onSelectDeck: (deck: DaoewoDeckView) => void;
  readonly onRequestDeck: () => void;
}

const categories: readonly CategoryFilter[] = [
  '전체',
  '언어',
  '자격증',
  '직무',
  '교양',
  'K-12',
];

export function CatalogScreen({
  decks,
  entitlement,
  now,
  onBack,
  onBrowseCategory,
  onSelectDeck,
  onRequestDeck,
}: CatalogScreenProps) {
  const {colors} = useDaoewoTheme();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('전체');
  const [tier, setTier] = useState<TierFilter>('all');
  const normalizedQuery = query.trim().toLocaleLowerCase('ko-KR');
  const filtered = useMemo(
    () =>
      filterDaoewoCatalog(
        decks,
        {
          query: normalizedQuery,
          category: category === '전체' ? undefined : category,
          tier,
        },
      ),
    [category, decks, entitlement, normalizedQuery, now, tier],
  );
  const isPro = hasActiveProEntitlement(entitlement, now);

  useEffect(() => {
    onBrowseCategory(category === '전체' ? 'all' : category);
  }, [category, onBrowseCategory]);

  return (
    <Screen accessibilityLabel="덱 탐색 화면">
      <TopBar title="덱 탐색" onBack={onBack} backLabel="덱 탐색 닫기" />
      <View style={[styles.searchBox, {backgroundColor: colors.surface, borderColor: colors.border}]}>
        <AppText style={[styles.searchSymbol, {color: colors.textMuted}]}>⌕</AppText>
        <TextInput
          accessibilityLabel="덱 검색"
          accessibilityHint="덱 제목, 분야, 태그로 찾습니다"
          allowFontScaling
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          maxFontSizeMultiplier={2}
          onChangeText={setQuery}
          placeholder="무엇을 외울까요?"
          placeholderTextColor={colors.textMuted}
          returnKeyType="search"
          style={[styles.searchInput, {color: colors.text}]}
          value={query}
        />
      </View>

      <AppText accessibilityRole="header" style={styles.filterTitle}>
        분야
      </AppText>
      <ScrollView
        accessibilityLabel="덱 분야 필터"
        contentContainerStyle={styles.filterScroll}
        horizontal
        showsHorizontalScrollIndicator={false}>
        {categories.map(item => (
          <Chip
            key={item}
            label={item}
            selected={category === item}
            onPress={() => setCategory(item)}
            accessibilityHint={`${item} 분야 덱만 봅니다`}
          />
        ))}
      </ScrollView>
      <View style={styles.tierRow} accessibilityRole="radiogroup">
        <Chip label="전체" selected={tier === 'all'} onPress={() => setTier('all')} />
        <Chip label="Free" selected={tier === 'free'} onPress={() => setTier('free')} />
        <Chip label="Pro" selected={tier === 'pro'} onPress={() => setTier('pro')} />
      </View>

      <View style={styles.catalogHeading}>
        <AppText accessibilityRole="header" style={styles.catalogTitle}>
          {query || category !== '전체' || tier !== 'all' ? '검색 결과' : '추천 큐레이션 덱'}
        </AppText>
        <AppText style={[styles.resultCount, {color: colors.textMuted}]}>
          {filtered.length}개
        </AppText>
      </View>

      {filtered.length === 0 ? (
        <EmptyState
          title="일치하는 덱이 없어요"
          description="검색어를 바꾸거나 원하는 주제를 직접 요청해 주세요."
        />
      ) : (
        <View style={styles.catalogList}>
          {filtered.map(deck => {
            const comingSoon = deck.availability === 'coming-soon';
            const locked = !comingSoon && deck.tier === 'pro' && !isPro;
            const cardCountLabel =
              deck.cardCount === null
                ? '카드 수 준비 중'
                : `${deck.cardCount.toLocaleString('ko-KR')}장`;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${deck.title}, ${cardCountLabel}, ${deck.tier === 'pro' ? 'Pro 덱' : '무료 덱'}${comingSoon ? ', 준비 중' : locked ? ', 잠김' : ''}`}
                accessibilityHint={
                  comingSoon
                    ? '덱 준비 현황과 요청 안내를 엽니다'
                    : locked
                      ? 'Pro 구독 안내를 엽니다'
                      : '덱 상세와 목표 설정을 엽니다'
                }
                key={deck.id}
                onPress={() => onSelectDeck(deck)}
                style={({pressed}) => [
                  styles.catalogCard,
                  {backgroundColor: colors.surface, borderColor: colors.border},
                  pressed ? styles.pressed : undefined,
                ]}>
                <View
                  style={[
                    styles.deckMonogram,
                    {
                      backgroundColor: comingSoon
                        ? colors.warningSoft
                        : deck.tier === 'pro'
                          ? colors.accentSoft
                          : colors.successSoft,
                    },
                  ]}>
                  <AppText
                    style={[
                      styles.deckMonogramText,
                      {
                        color: comingSoon
                          ? colors.warning
                          : deck.tier === 'pro'
                            ? colors.accent
                            : colors.success,
                      },
                    ]}>
                    {deck.title.slice(0, 1)}
                  </AppText>
                </View>
                <View style={styles.catalogCardCopy}>
                  <View style={styles.catalogCardTopLine}>
                    <AppText style={styles.catalogCardTitle} numberOfLines={2}>
                      {deck.title}
                    </AppText>
                    {locked ? (
                      <AppText style={[styles.lock, {color: colors.accent}]}>▣</AppText>
                    ) : null}
                  </View>
                  <AppText style={[styles.catalogCardDescription, {color: colors.textMuted}]} numberOfLines={2}>
                    {deck.subtitle}
                  </AppText>
                  <View style={styles.catalogMeta}>
                    <Badge
                      label={deck.tier === 'pro' ? 'Pro' : 'Free'}
                      tone={deck.tier === 'pro' ? 'accent' : 'success'}
                    />
                    {comingSoon ? <Badge label="준비 중" tone="warning" /> : null}
                    {deck.isNew ? <Badge label="NEW" tone="warning" /> : null}
                    <AppText style={[styles.cardCount, {color: colors.textMuted}]}>
                      {cardCountLabel}
                    </AppText>
                  </View>
                </View>
                <AppText style={[styles.chevron, {color: colors.textMuted}]}>›</AppText>
              </Pressable>
            );
          })}
        </View>
      )}

      <Surface style={styles.requestCta}>
        <View style={styles.requestCtaCopy}>
          <AppText accessibilityRole="header" style={styles.requestCtaTitle}>
            찾는 덱이 없나요?
          </AppText>
          <AppText style={[styles.requestCtaDescription, {color: colors.textMuted}]}>
            필요한 주제를 알려주시면 발굴 대기열에 등록할게요.
          </AppText>
        </View>
        <SecondaryButton label="덱 요청하기" onPress={onRequestDeck} />
      </Surface>
    </Screen>
  );
}

export interface DeckRequestDraft {
  readonly topic: string;
  readonly category: DaoewoDeckCategory;
  readonly locale: '한국어' | '영어' | '일본어' | '기타';
  readonly note: string;
}

export function deckRequestLocaleCode(
  locale: DeckRequestDraft['locale'],
): string {
  const codes: Readonly<Record<DeckRequestDraft['locale'], string>> = {
    한국어: 'ko',
    영어: 'en',
    일본어: 'ja',
    기타: 'und',
  };
  return codes[locale];
}

interface DeckRequestScreenProps {
  readonly isPro: boolean;
  readonly onBack: () => void;
  readonly onSubmit: (draft: DeckRequestDraft) => Promise<void>;
}

const requestCategories: readonly DaoewoDeckCategory[] = [
  '언어',
  '자격증',
  '직무',
  '교양',
  'K-12',
];
const requestLocales: readonly DeckRequestDraft['locale'][] = [
  '한국어',
  '영어',
  '일본어',
  '기타',
];

export function DeckRequestScreen({
  isPro,
  onBack,
  onSubmit,
}: DeckRequestScreenProps) {
  const {colors} = useDaoewoTheme();
  const [topic, setTopic] = useState('');
  const [category, setCategory] = useState<DaoewoDeckCategory>('자격증');
  const [locale, setLocale] = useState<DeckRequestDraft['locale']>('한국어');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = topic.trim().length >= 2;

  const submit = async () => {
    const issues = validateDeckRequestContent({
      topic,
      category,
      locale: deckRequestLocaleCode(locale),
      note,
    });

    if (!valid || issues.length > 0 || submitting) {
      setError(issues[0]?.message ?? '외우고 싶은 주제를 두 글자 이상 입력해 주세요.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({topic: topic.trim(), category, locale, note: note.trim()});
      setSubmitted(true);
    } catch {
      setError('요청을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <Screen accessibilityLabel="덱 요청 완료 화면">
        <TopBar title="덱 요청" onBack={onBack} backLabel="덱 탐색으로 돌아가기" />
        <View style={styles.requestComplete} accessibilityLiveRegion="polite">
          <View style={[styles.completeSymbol, {backgroundColor: colors.successSoft}]}>
            <AppText style={[styles.completeCheck, {color: colors.success}]}>✓</AppText>
          </View>
          <AppText accessibilityRole="header" style={styles.completeTitle}>
            요청을 등록했어요
          </AppText>
          <AppText style={[styles.completeDescription, {color: colors.textMuted}]}>
            “{topic.trim()}” 덱을 검토하고, 준비되면 알림으로 알려 드릴게요.
          </AppText>
          <PrimaryButton label="덱 탐색으로 돌아가기" onPress={onBack} />
        </View>
      </Screen>
    );
  }

  const inputStyle = [
    styles.formInput,
    {backgroundColor: colors.surface, borderColor: colors.border, color: colors.text},
  ];

  return (
    <Screen accessibilityLabel="덱 요청 작성 화면">
      <TopBar title="덱 요청" onBack={onBack} backLabel="덱 요청 닫기" />
      <AppText accessibilityRole="header" style={styles.requestTitle}>
        어떤 걸 외우고 싶나요?
      </AppText>
      <AppText style={[styles.requestDescription, {color: colors.textMuted}]}>
        요청은 큐레이션 덱 발굴과 검수의 우선순위를 정하는 데 사용돼요.
      </AppText>

      <AppText style={styles.fieldLabel}>주제</AppText>
      <TextInput
        accessibilityLabel="외우고 싶은 주제"
        allowFontScaling
        maxFontSizeMultiplier={2}
        onChangeText={setTopic}
        placeholder="예: 관세사 1차 관세법 핵심 조문"
        placeholderTextColor={colors.textMuted}
        returnKeyType="next"
        style={inputStyle}
        value={topic}
      />

      <AppText style={styles.fieldLabel}>분야</AppText>
      <View style={styles.formChips}>
        {requestCategories.map(item => (
          <Chip
            key={item}
            label={item}
            selected={category === item}
            onPress={() => setCategory(item)}
          />
        ))}
      </View>

      <AppText style={styles.fieldLabel}>언어</AppText>
      <View style={styles.formChips}>
        {requestLocales.map(item => (
          <Chip
            key={item}
            label={item}
            selected={locale === item}
            onPress={() => setLocale(item)}
          />
        ))}
      </View>

      <AppText style={styles.fieldLabel}>참고 링크·메모 (선택)</AppText>
      <TextInput
        accessibilityLabel="덱 요청 참고 메모"
        allowFontScaling
        maxFontSizeMultiplier={2}
        multiline
        onChangeText={setNote}
        placeholder="필요한 범위나 시험 일정 등을 알려 주세요."
        placeholderTextColor={colors.textMuted}
        style={[...inputStyle, styles.noteInput]}
        textAlignVertical="top"
        value={note}
      />

      {error ? (
        <AppText accessibilityLiveRegion="assertive" style={[styles.formError, {color: colors.danger}]}>
          {error}
        </AppText>
      ) : null}
      <View style={styles.submitArea}>
        <PrimaryButton
          label="요청 보내기"
          onPress={submit}
          loading={submitting}
          accessibilityHint="입력한 주제를 덱 발굴 대기열에 등록합니다"
        />
        <AppText style={[styles.priorityNote, {color: colors.textMuted}]}>
          {isPro
            ? 'Pro 요청은 우선 대기열에서 검토됩니다.'
            : '요청은 일반 대기열에 등록됩니다. Pro는 우선 처리돼요.'}
        </AppText>
      </View>
    </Screen>
  );
}

interface StatisticsScreenProps {
  readonly isPro: boolean;
  readonly summary: DaoewoDashboardSummary;
  readonly navigate: (screen: DaoewoScreen) => void;
  readonly onContinueStudy: () => void;
  readonly onShare: () => void;
}

export function StatisticsScreen({
  isPro,
  summary,
  navigate,
  onContinueStudy,
  onShare,
}: StatisticsScreenProps) {
  const {colors} = useDaoewoTheme();
  const [shared, setShared] = useState(false);

  return (
    <Screen
      accessibilityLabel="통계와 학습 진행 화면"
      footer={<BottomNavigation current="statistics" navigate={navigate} />}>
      <View style={styles.statsHeader}>
        <AppText accessibilityRole="header" style={styles.statsTitle}>통계</AppText>
        <Badge label="이번 주" tone="accent" />
      </View>

      <Surface accessibilityLabel={`현재 스트릭 ${summary.streak.current}일, 최장 스트릭 ${summary.streak.longest}일`}>
        <View style={styles.streakHeading}>
          <View style={[styles.streakIcon, {backgroundColor: colors.warningSoft}]}>
            <AppText style={styles.streakEmoji}>🔥</AppText>
          </View>
          <View>
            <AppText style={[styles.statsEyebrow, {color: colors.textMuted}]}>현재 스트릭</AppText>
            <AppText style={styles.statsBigNumber}>{summary.streak.current}일</AppText>
          </View>
          <View style={styles.bestStreak}>
            <AppText style={[styles.statsEyebrow, {color: colors.textMuted}]}>최장</AppText>
            <AppText style={styles.bestStreakValue}>{summary.streak.longest}일</AppText>
          </View>
        </View>
        <View style={styles.weekRow}>
          {summary.week.map(item => (
            <View accessibilityLabel={`${item.date} ${item.label}요일, ${item.complete ? '학습 완료' : '학습 완료 기록 없음'}`} key={item.date} style={styles.dayColumn}>
              <AppText style={[styles.dayLabel, {color: colors.textMuted}]}>{item.label}</AppText>
              <View
                style={[
                  styles.dayState,
                  {
                    backgroundColor: item.complete ? colors.accent : colors.border,
                  },
                ]}>
                {item.complete ? <AppText style={[styles.dayCheck, {color: colors.accentText}]}>✓</AppText> : null}
              </View>
            </View>
          ))}
        </View>
      </Surface>

      <View style={styles.statsSection}>
        <AppText accessibilityRole="header" style={styles.statsSectionTitle}>암기 현황</AppText>
        <View style={styles.statsNumbers}>
          <View style={[styles.statTile, {backgroundColor: colors.successSoft}]}>
            <AppText style={[styles.statLabel, {color: colors.success}]}>암기됨</AppText>
            <AppText style={styles.statValue}>{summary.memorizedCount}</AppText>
          </View>
          <View style={[styles.statTile, {backgroundColor: colors.warningSoft}]}>
            <AppText style={[styles.statLabel, {color: colors.warning}]}>학습 중</AppText>
            <AppText style={styles.statValue}>{summary.learningCount}</AppText>
          </View>
        </View>
        <View style={styles.memorizationHeading}>
          <AppText style={styles.memorizationLabel}>전체 암기율</AppText>
          <AppText style={[styles.memorizationValue, {color: colors.success}]}>{summary.memorizationRate}%</AppText>
        </View>
        <ProgressBar label={`전체 암기율 ${summary.memorizationRate}퍼센트`} value={summary.memorizationRate / 100} tone="success" />
      </View>

      <Surface style={styles.advancedStats}>
        <View style={styles.advancedHeading}>
          <AppText accessibilityRole="header" style={styles.advancedTitle}>학습 인사이트</AppText>
          {!isPro ? <Badge label="Pro" tone="accent" /> : null}
        </View>
        {isPro ? (
          <>
            <View style={styles.insightRow}>
              <AppText style={[styles.insightLabel, {color: colors.textMuted}]}>예상 완료일</AppText>
              <AppText style={styles.insightValue}>
                {summary.estimatedCompletionDate === null
                  ? '계산할 기록 없음'
                  : formatKoreanDate(summary.estimatedCompletionDate)}
              </AppText>
            </View>
            <AppText style={[styles.weaknessLabel, {color: colors.textMuted}]}>약점 태그</AppText>
            {summary.weaknessTags.length > 0 ? (
              <View style={styles.weaknessRow}>
                {summary.weaknessTags.map(tag => (
                  <Badge
                    key={tag.label}
                    label={`#${tag.label} ${tag.rate}%`}
                    tone={tag.rate >= 60 ? 'danger' : 'warning'}
                  />
                ))}
              </View>
            ) : (
              <AppText style={[styles.lockPlaceholder, {color: colors.textMuted}]}>
                학습 기록이 쌓이면 약점 태그를 계산해 드려요.
              </AppText>
            )}
          </>
        ) : (
          <View accessibilityLabel="Pro 고급 통계 잠김" style={styles.lockPlaceholderGroup}>
            <AppText style={[styles.lockPlaceholder, {color: colors.textMuted}]}>
              예상 완료일과 약점 태그는 Pro에서 확인할 수 있어요.
            </AppText>
            <SecondaryButton label="고급 통계 잠금 해제" onPress={() => navigate('paywall')} />
          </View>
        )}
      </Surface>

      <View style={styles.statsPrimaryAction}>
        <PrimaryButton label="오늘 학습 이어하기" onPress={onContinueStudy} />
        <SecondaryButton
          label="이번 주 기록 공유하기"
          onPress={() => {
            onShare();
            setShared(true);
          }}
        />
        {shared ? (
          <AppText
            accessibilityLiveRegion="polite"
            style={[styles.shareMessage, {color: colors.textMuted}]}>
            공유 기능은 현재 앱에서 지원되지 않아요.
          </AppText>
        ) : null}
      </View>
    </Screen>
  );
}

function formatKoreanDate(dateKey: string): string {
  const [, month = '', day = ''] = dateKey.split('-');
  return `${Number(month)}월 ${Number(day)}일`;
}

const styles = StyleSheet.create({
  pressed: {opacity: 0.74, transform: [{scale: 0.995}]},
  searchBox: {height: 54, borderRadius: 18, borderWidth: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16},
  searchSymbol: {fontSize: 25, lineHeight: 28, marginRight: 10},
  searchInput: {flex: 1, fontSize: 16, lineHeight: 22, paddingVertical: 0},
  filterTitle: {fontSize: 16, lineHeight: 22, fontWeight: '700', marginTop: 25, marginBottom: 10},
  filterScroll: {paddingRight: 20},
  tierRow: {flexDirection: 'row', marginTop: 4},
  catalogHeading: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, marginBottom: 12},
  catalogTitle: {fontSize: 20, lineHeight: 27, fontWeight: '800'},
  resultCount: {fontSize: 13, lineHeight: 18, fontWeight: '600'},
  catalogList: {gap: 11},
  catalogCard: {minHeight: 116, borderRadius: 22, borderWidth: 1, padding: 15, flexDirection: 'row', alignItems: 'center'},
  deckMonogram: {width: 58, height: 70, borderRadius: 16, alignItems: 'center', justifyContent: 'center'},
  deckMonogramText: {fontSize: 24, lineHeight: 31, fontWeight: '800'},
  catalogCardCopy: {flex: 1, paddingHorizontal: 14},
  catalogCardTopLine: {flexDirection: 'row', alignItems: 'flex-start'},
  catalogCardTitle: {flex: 1, fontSize: 16, lineHeight: 22, fontWeight: '700'},
  lock: {fontSize: 15, lineHeight: 20, marginLeft: 5},
  catalogCardDescription: {fontSize: 12, lineHeight: 18, marginTop: 3},
  catalogMeta: {flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 9},
  cardCount: {fontSize: 12, lineHeight: 17, marginLeft: 2},
  chevron: {fontSize: 28, lineHeight: 31, fontWeight: '300'},
  requestCta: {marginTop: 28, gap: 16},
  requestCtaCopy: {alignItems: 'center'},
  requestCtaTitle: {fontSize: 19, lineHeight: 26, fontWeight: '700'},
  requestCtaDescription: {fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 5},
  requestTitle: {fontSize: 27, lineHeight: 36, fontWeight: '800', marginTop: 8},
  requestDescription: {fontSize: 14, lineHeight: 22, marginTop: 8, marginBottom: 24},
  fieldLabel: {fontSize: 14, lineHeight: 20, fontWeight: '700', marginTop: 18, marginBottom: 8},
  formInput: {minHeight: 54, borderRadius: 17, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 13, fontSize: 16, lineHeight: 23},
  noteInput: {minHeight: 112},
  formChips: {flexDirection: 'row', flexWrap: 'wrap'},
  formError: {fontSize: 13, lineHeight: 19, marginTop: 12},
  submitArea: {marginTop: 28},
  priorityNote: {fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 12},
  requestComplete: {flex: 1, justifyContent: 'center', alignItems: 'stretch', paddingBottom: 50},
  completeSymbol: {width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', alignSelf: 'center'},
  completeCheck: {fontSize: 36, lineHeight: 42, fontWeight: '800'},
  completeTitle: {fontSize: 26, lineHeight: 35, fontWeight: '800', textAlign: 'center', marginTop: 24},
  completeDescription: {fontSize: 15, lineHeight: 23, textAlign: 'center', marginTop: 9, marginBottom: 28},
  statsHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 20, paddingBottom: 24},
  statsTitle: {fontSize: 31, lineHeight: 40, fontWeight: '800'},
  streakHeading: {flexDirection: 'row', alignItems: 'center'},
  streakIcon: {width: 56, height: 56, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: 13},
  streakEmoji: {fontSize: 27, lineHeight: 32},
  statsEyebrow: {fontSize: 12, lineHeight: 17},
  statsBigNumber: {fontSize: 26, lineHeight: 33, fontWeight: '800'},
  bestStreak: {marginLeft: 'auto', alignItems: 'flex-end'},
  bestStreakValue: {fontSize: 17, lineHeight: 23, fontWeight: '700', marginTop: 1},
  weekRow: {flexDirection: 'row', justifyContent: 'space-between', marginTop: 24},
  dayColumn: {alignItems: 'center'},
  dayLabel: {fontSize: 11, lineHeight: 16, marginBottom: 7},
  dayState: {width: 31, height: 31, borderRadius: 11, alignItems: 'center', justifyContent: 'center'},
  dayCheck: {fontSize: 13, lineHeight: 17, fontWeight: '800'},
  statsSection: {marginTop: 30},
  statsSectionTitle: {fontSize: 20, lineHeight: 27, fontWeight: '800', marginBottom: 14},
  statsNumbers: {flexDirection: 'row', gap: 12},
  statTile: {flex: 1, borderRadius: 20, padding: 18},
  statLabel: {fontSize: 13, lineHeight: 18, fontWeight: '700'},
  statValue: {fontSize: 28, lineHeight: 36, fontWeight: '800', marginTop: 3},
  memorizationHeading: {flexDirection: 'row', justifyContent: 'space-between', marginTop: 20, marginBottom: 9},
  memorizationLabel: {fontSize: 14, lineHeight: 20, fontWeight: '600'},
  memorizationValue: {fontSize: 15, lineHeight: 20, fontWeight: '800'},
  advancedStats: {marginTop: 30},
  advancedHeading: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 17},
  advancedTitle: {fontSize: 19, lineHeight: 26, fontWeight: '800'},
  lockPlaceholderGroup: {gap: 14},
  lockPlaceholder: {fontSize: 14, lineHeight: 21},
  insightRow: {flexDirection: 'row', justifyContent: 'space-between'},
  insightLabel: {fontSize: 14, lineHeight: 20},
  insightValue: {fontSize: 15, lineHeight: 21, fontWeight: '700'},
  weaknessLabel: {fontSize: 14, lineHeight: 20, marginTop: 18},
  weaknessRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginVertical: 10},
  statsPrimaryAction: {marginTop: 24, gap: 10},
  shareMessage: {fontSize: 12, lineHeight: 18, textAlign: 'center'},
});
