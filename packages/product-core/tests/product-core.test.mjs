import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const typeScriptCompiler = fileURLToPath(
  new URL('../node_modules/typescript/bin/tsc', import.meta.url),
);
execFileSync(process.execPath, [typeScriptCompiler, '-p', `${packageRoot}/tsconfig.json`], {
  stdio: 'inherit',
});

const core = await import('../dist/index.js');

const {
  DECK_REQUEST_LIMITS,
  FREE_LIMITS,
  PRO_LIMITS,
  SRS_INTERVAL_MS,
  addDaysToDateKey,
  allocateCardsByGoal,
  buildCalendarDayStates,
  buildDailyAssignment,
  buildDueReviewQueue,
  calculateCompletionStreak,
  calculateLongestCompletionStreak,
  calculateNextReview,
  calculateStudyStatistics,
  calculateStudyStreak,
  classifySwipe,
  createDeckRequest,
  createDeliveryWindowDeckRegistry,
  createInitialCardProgress,
  createStudyGoal,
  daysBetweenDateKeys,
  evaluateDeckActivation,
  filterCatalogMetadata,
  getAssignedCardIds,
  getProductLimits,
  getStudyGoalEndDate,
  isDateKey,
  isEntitled,
  resolveDailyCardLimit,
  toDateKey,
  validateDeckRequest,
  validateDeckRequestContent,
} = core;

const FREE = { plan: 'free', source: 'local', validUntil: null };
const PRO = { plan: 'pro', source: 'test', validUntil: null };
const NOW = new Date('2026-07-12T00:00:00.000Z');

test('toDateKey는 같은 절대 시각을 지정 timezone의 날짜로 변환한다', () => {
  const instant = new Date('2026-07-11T15:30:00.000Z');

  assert.equal(toDateKey(instant), '2026-07-12');
  assert.equal(toDateKey(instant, 'UTC'), '2026-07-11');
  assert.equal(toDateKey(new Date('2026-07-11T14:59:59.999Z')), '2026-07-11');
});

test('date key 검증과 달력 연산은 host timezone에 의존하지 않는다', () => {
  assert.equal(isDateKey('2026-02-29'), false);
  assert.equal(isDateKey('2028-02-29'), true);
  assert.equal(addDaysToDateKey('2028-02-28', 1), '2028-02-29');
  assert.equal(addDaysToDateKey('2028-02-29', 1), '2028-03-01');
  assert.equal(addDaysToDateKey('2026-01-01', -1), '2025-12-31');
  assert.equal(daysBetweenDateKeys('2026-12-31', '2027-01-02'), 2);
});

test('days 목표는 앞 날짜부터 최대 1장 차이로 균등 배분한다', () => {
  const allocation = allocateCardsByGoal({
    cardIds: ids(7),
    startDate: '2026-07-12',
    mode: 'days',
    value: 3,
  });

  assert.equal(allocation.days, 3);
  assert.equal(allocation.dailyCount, 3);
  assert.deepEqual(Object.values(allocation.assignments).map((cards) => cards.length), [3, 2, 2]);
  assert.deepEqual(Object.values(allocation.assignments).flat(), ids(7));
});

test('daily-count 목표는 마지막 날을 제외하고 요청 수량을 유지한다', () => {
  const goal = createStudyGoal({
    deckId: 'deck-1',
    cardIds: ids(7),
    startDate: '2026-07-12',
    mode: 'daily-count',
    value: 3,
  });

  assert.equal(goal.key, 'deck-1');
  assert.equal(goal.totalCount, 7);
  assert.equal(goal.days, 3);
  assert.equal(goal.dailyCount, 3);
  assert.deepEqual(Object.values(goal.assignments).map((cards) => cards.length), [3, 3, 1]);
  assert.equal(getStudyGoalEndDate(goal), '2026-07-14');
  assert.deepEqual(getAssignedCardIds(goal, '2026-07-13'), ['card-3', 'card-4', 'card-5']);
});

test('목표 날짜가 카드 수보다 많아도 명시한 날짜 수를 보존한다', () => {
  const allocation = allocateCardsByGoal({
    cardIds: ids(2),
    startDate: '2026-07-12',
    mode: 'days',
    value: 4,
  });

  assert.deepEqual(Object.values(allocation.assignments).map((cards) => cards.length), [1, 1, 0, 0]);
});

test('buildDailyAssignment는 metadata cardCount를 index 문자열로 배분한다', () => {
  const byEndDate = buildDailyAssignment({
    cardCount: 5,
    startDate: '2026-07-12',
    endDate: '2026-07-13',
  });
  const byDailyTarget = buildDailyAssignment({
    cardIds: ['a', 'b', 'c', 'd', 'e'],
    startDate: '2026-07-12',
    dailyTarget: 2,
  });

  assert.deepEqual(byEndDate, {
    '2026-07-12': ['0', '1', '2'],
    '2026-07-13': ['3', '4'],
  });
  assert.deepEqual(Object.values(byDailyTarget), [['a', 'b'], ['c', 'd'], ['e']]);
});

test('목표 배분은 잘못된 수량과 중복 카드 ID를 거부한다', () => {
  assert.throws(
    () => allocateCardsByGoal({ cardIds: ['a'], startDate: '2026-07-12', mode: 'days', value: 0 }),
    /positive integer/,
  );
  assert.throws(
    () => allocateCardsByGoal({ cardIds: ['a', 'a'], startDate: '2026-07-12', mode: 'days', value: 1 }),
    /unique/,
  );
  assert.throws(
    () => buildDailyAssignment({ cardCount: 3, startDate: '2026-07-12' }),
    /Exactly one/,
  );
});

test('known swipe는 원본을 변경하지 않고 known 상태와 연속 성공을 누적한다', () => {
  const initial = makeProgress();
  const result = classifySwipe(initial, 'known', NOW);

  assert.equal(initial.status, 'new');
  assert.equal(result.status, 'known');
  assert.equal(result.knownCount, 1);
  assert.equal(result.unknownCount, 0);
  assert.equal(result.streak, 1);
  assert.equal(result.nextReviewAt, null);
  assert.equal(result.firstSeenAt, NOW.toISOString());
});

test('unknown swipe는 learning 상태와 즉시 due 복습을 만든다', () => {
  const result = classifySwipe(makeProgress(), 'unknown', NOW);

  assert.equal(result.status, 'learning');
  assert.equal(result.unknownCount, 1);
  assert.equal(result.streak, 0);
  assert.equal(result.nextReviewAt, NOW.toISOString());
  assert.equal(buildDueReviewQueue([result], NOW)[0]?.source, 'swipe-unknown');
});

test('SRS easy는 1일 뒤, confused는 1시간 뒤, missed는 10분 뒤다', () => {
  const initial = makeProgress();
  const easy = calculateNextReview(initial, 'easy', NOW);
  const confused = calculateNextReview(initial, 'confused', NOW);
  const missed = calculateNextReview(initial, 'missed', NOW);

  assert.equal(Date.parse(easy.nextReviewAt) - NOW.getTime(), SRS_INTERVAL_MS.easy);
  assert.equal(Date.parse(confused.nextReviewAt) - NOW.getTime(), SRS_INTERVAL_MS.confused);
  assert.equal(Date.parse(missed.nextReviewAt) - NOW.getTime(), SRS_INTERVAL_MS.missed);
  assert.equal(easy.status, 'known');
  assert.equal(confused.status, 'reviewing');
  assert.equal(missed.status, 'learning');
  assert.equal(easy.reviewCount, 1);
  assert.equal(confused.streak, 0);
});

test('due review queue는 due 이전과 suspended를 제외하고 dueAt 순으로 정렬한다', () => {
  const missed = calculateNextReview(makeProgress({ cardId: 'missed' }), 'missed', NOW);
  const confused = calculateNextReview(makeProgress({ cardId: 'confused' }), 'confused', NOW);
  const future = calculateNextReview(makeProgress({ cardId: 'future' }), 'easy', NOW);
  const suspended = { ...missed, cardId: 'suspended', status: 'suspended' };
  const queue = buildDueReviewQueue(
    [future, confused, suspended, missed],
    new Date(NOW.getTime() + SRS_INTERVAL_MS.confused),
  );

  assert.deepEqual(queue.map((item) => item.cardId), ['missed', 'confused']);
  assert.deepEqual(queue.map((item) => item.source), ['review-missed', 'review-confused']);
});

test('Free/Pro entitlement는 만료 시각을 엄격하게 판정한다', () => {
  const future = { plan: 'pro', source: 'test', validUntil: '2026-07-12T00:00:01.000Z' };
  const exact = { plan: 'pro', source: 'test', validUntil: NOW.toISOString() };
  const invalid = { plan: 'pro', source: 'test', validUntil: 'not-a-date' };

  assert.equal(isEntitled(FREE, NOW), false);
  assert.equal(isEntitled(PRO, NOW), true);
  assert.equal(isEntitled(future, NOW), true);
  assert.equal(isEntitled(exact, NOW), false);
  assert.equal(isEntitled(invalid, NOW), false);
  assert.deepEqual(getProductLimits(FREE, NOW), FREE_LIMITS);
  assert.deepEqual(getProductLimits(PRO, NOW), PRO_LIMITS);
});

test('Free는 활성 1덱·일일 60장, Pro는 제품 한도가 없다', () => {
  const freeDeck = makeDeck({ id: 'free-2' });
  const proDeck = makeDeck({ id: 'pro-1', tier: 'pro' });

  assert.deepEqual(
    evaluateDeckActivation({ deck: freeDeck, activeDeckIds: ['free-1'], entitlement: FREE, now: NOW }),
    { allowed: false, reason: 'active-deck-limit' },
  );
  assert.deepEqual(
    evaluateDeckActivation({ deck: proDeck, activeDeckIds: [], entitlement: FREE, now: NOW }),
    { allowed: false, reason: 'pro-required' },
  );
  assert.equal(
    evaluateDeckActivation({ deck: proDeck, activeDeckIds: ['a', 'b'], entitlement: PRO, now: NOW }).allowed,
    true,
  );
  assert.equal(resolveDailyCardLimit(FREE, 100, NOW), 60);
  assert.equal(resolveDailyCardLimit(PRO, 1000, NOW), 1000);
});

test('서버 window는 요청 deck과 bind되고 commit caller가 deckId를 바꿀 수 없다', () => {
  const registry = createDeliveryWindowDeckRegistry();
  registry.bind({
    requestedDeckId: 'pro-deck',
    authoritativeDeckId: 'pro-deck',
    windowId: 'server-window-1',
  });
  assert.doesNotThrow(() => registry.assertBound('server-window-1', 'pro-deck'));
  assert.throws(
    () => registry.assertBound('server-window-1', 'free-deck'),
    /권위 덱/,
  );
  assert.throws(
    () => registry.bind({
      requestedDeckId: 'pro-deck',
      authoritativeDeckId: 'free-deck',
      windowId: 'server-window-2',
    }),
    /응답이 요청과 일치/,
  );
});

test('이미 활성화한 Free 덱은 한도에 걸리지 않는다', () => {
  const deck = makeDeck({ id: 'same' });
  const result = evaluateDeckActivation({ deck, activeDeckIds: ['same'], entitlement: FREE, now: NOW });
  assert.equal(result.allowed, true);
});

test('Free catalog에도 Pro metadata를 잠금 상태로 노출한다', () => {
  const decks = [
    makeDeck({ id: 'free', title: '기초 영단어', tier: 'free', tags: ['영어', '기초'] }),
    makeDeck({ id: 'pro', title: '고급 영단어', tier: 'pro', tags: ['영어', '고급'] }),
  ];
  const freeCatalog = filterCatalogMetadata(decks, { tags: ['영어'] }, FREE, NOW);
  const proCatalog = filterCatalogMetadata(decks, { query: '고급' }, PRO, NOW);

  assert.deepEqual(freeCatalog.map(({ id, isLocked }) => ({ id, isLocked })), [
    { id: 'free', isLocked: false },
    { id: 'pro', isLocked: true },
  ]);
  assert.deepEqual(proCatalog.map(({ id, isLocked }) => ({ id, isLocked })), [
    { id: 'pro', isLocked: false },
  ]);
});

test('deck request content validation은 필수값·locale·길이를 검사한다', () => {
  const issues = validateDeckRequestContent({
    topic: 'a',
    category: '',
    locale: 'korean',
    note: 'x'.repeat(DECK_REQUEST_LIMITS.noteMaxLength + 1),
  });

  assert.deepEqual(new Set(issues.map((item) => item.field)), new Set(['topic', 'category', 'locale', 'note']));
});

test('deck request 생성은 문자열을 정규화하고 기본 queued 상태를 설정한다', () => {
  const request = createDeckRequest(
    {
      id: ' request-1 ',
      topic: ' 여행 영어 ',
      category: ' 영어 ',
      locale: ' ko-KR ',
      note: ' 공항 표현 ',
      requesterId: ' user-1 ',
    },
    NOW,
  );

  assert.deepEqual(request, {
    id: 'request-1',
    topic: '여행 영어',
    category: '영어',
    locale: 'ko-KR',
    note: '공항 표현',
    status: 'queued',
    requesterId: 'user-1',
    requestedAt: NOW.toISOString(),
  });
  assert.equal(validateDeckRequest(request).valid, true);
});

test('calendar state는 목표·완료·암기율·elapsed를 날짜별로 계산한다', () => {
  const goal = createStudyGoal({
    deckId: 'deck-1',
    cardIds: ids(4),
    startDate: '2026-07-10',
    mode: 'daily-count',
    value: 2,
  });
  const days = buildCalendarDayStates(
    goal,
    [
      { date: '2026-07-10', completed: 2, known: 1, unknown: 1, reviewCount: 1, elapsed: 1_000 },
      { date: '2026-07-11', completed: 1, known: 1, unknown: 0, reviewCount: 0, elapsed: 500 },
    ],
    '2026-07-12',
  );

  assert.deepEqual(days.map((day) => day.status), ['completed', 'in-progress']);
  assert.deepEqual(days.map((day) => day.memorizationRate), [50, 100]);
  assert.deepEqual(calculateStudyStatistics(days), {
    target: 4,
    completed: 3,
    completionRate: 75,
    memorizationRate: 67,
    elapsed: 1_500,
    known: 2,
    unknown: 1,
    reviewCount: 1,
  });
});

test('calendar state는 지나간 미시작 날짜를 missed로 표시한다', () => {
  const goal = createStudyGoal({
    deckId: 'deck-1',
    cardIds: ids(2),
    startDate: '2026-07-10',
    mode: 'daily-count',
    value: 1,
  });

  assert.deepEqual(
    buildCalendarDayStates(goal, [], '2026-07-11').map((day) => day.status),
    ['missed', 'scheduled'],
  );
});

test('스트릭은 완료한 달력 날짜가 실제로 연속일 때만 이어진다', () => {
  const dates = ['2026-07-07', '2026-07-08', '2026-07-10', '2026-07-11'];

  assert.equal(calculateCompletionStreak(dates, '2026-07-12'), 2);
  assert.equal(calculateCompletionStreak(dates, '2026-07-13'), 0);
  assert.equal(calculateLongestCompletionStreak(dates), 2);
  assert.deepEqual(calculateStudyStreak([...dates, '2026-07-12'], '2026-07-12'), {
    current: 3,
    longest: 3,
  });
});

function ids(count) {
  return Array.from({ length: count }, (_, index) => `card-${index}`);
}

function makeProgress(overrides = {}) {
  return {
    ...createInitialCardProgress(overrides.cardId ?? 'card-1', overrides.deckId ?? 'deck-1', NOW),
    ...overrides,
  };
}

function makeDeck(overrides = {}) {
  return {
    id: 'deck-1',
    title: '기초 암기',
    category: '언어',
    locale: 'ko-KR',
    source: 'official',
    tier: 'free',
    license: 'internal',
    level: 'beginner',
    cardCount: 100,
    tags: ['기초'],
    ...overrides,
  };
}
