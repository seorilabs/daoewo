export type DaoewoDeckTier = 'free' | 'pro';
export type DaoewoDeckAvailability = 'coming-soon' | 'published';

export type DaoewoDeckCategory =
  | '언어'
  | '자격증'
  | '직무'
  | '교양'
  | 'K-12';

export interface DaoewoDeckView {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly category: DaoewoDeckCategory;
  readonly locale: string;
  readonly tier: DaoewoDeckTier;
  readonly source: 'official' | 'ai-batch' | 'requested';
  readonly availability: DaoewoDeckAvailability;
  readonly cardCount: number | null;
  readonly tags: readonly string[];
  readonly isNew?: boolean;
  readonly progress?: number;
  readonly daysLeft?: number;
}

export interface DaoewoCardView {
  readonly id: string;
  readonly deckId: string;
  readonly front: string;
  readonly reading?: string;
  readonly back: string;
  readonly hint?: string;
  readonly example?: string;
  readonly exampleMeaning?: string;
  readonly tags: readonly string[];
  readonly locale: string;
}

export const DEMO_DECKS: readonly DaoewoDeckView[] = [
  {
    id: 'english-starter',
    title: '영어 필수단어 입문',
    subtitle: '매일 쓰는 기본 영단어',
    category: '언어',
    locale: '영어',
    tier: 'free',
    source: 'official',
    availability: 'published',
    cardCount: 600,
    tags: ['영어', '입문'],
    isNew: true,
    progress: 0.45,
    daysLeft: 14,
  },
  {
    id: 'english-advanced',
    title: '영어 심화 빈출',
    subtitle: '시험과 실무를 위한 고급 어휘',
    category: '언어',
    locale: '영어',
    tier: 'pro',
    source: 'official',
    availability: 'published',
    cardCount: 1250,
    tags: ['영어', '심화'],
  },
  {
    id: 'jlpt-n5',
    title: '일본어 N5 맛보기',
    subtitle: '히라가나 다음 첫 단어',
    category: '언어',
    locale: '일본어',
    tier: 'free',
    source: 'official',
    availability: 'published',
    cardCount: 240,
    tags: ['일본어', 'N5'],
    progress: 0.62,
    daysLeft: 9,
  },
  {
    id: 'jlpt-n3-n2',
    title: '일본어 N3~N2',
    subtitle: '단계별 핵심 어휘와 예문',
    category: '언어',
    locale: '일본어',
    tier: 'pro',
    source: 'official',
    availability: 'published',
    cardCount: 2688,
    tags: ['일본어', 'N3', 'N2'],
  },
  {
    id: 'korean-vocabulary',
    title: '국어 어휘',
    subtitle: '문해력을 높이는 우리말',
    category: '언어',
    locale: '한국어',
    tier: 'free',
    source: 'official',
    availability: 'published',
    cardCount: 800,
    tags: ['국어', '어휘'],
  },
  {
    id: 'korean-history-test',
    title: '한국사능력검정 핵심',
    subtitle: '시대별 사건과 인물 정리',
    category: '자격증',
    locale: '한국어',
    tier: 'pro',
    source: 'ai-batch',
    availability: 'published',
    cardCount: 500,
    tags: ['한국사', '시험'],
    isNew: true,
  },
  {
    id: 'information-processing',
    title: '정보처리기사 요약',
    subtitle: '필기 핵심 개념 빠른 회독',
    category: '자격증',
    locale: '한국어',
    tier: 'pro',
    source: 'ai-batch',
    availability: 'published',
    cardCount: 320,
    tags: ['자격증', 'IT'],
    isNew: true,
  },
  {
    id: 'drivers-license',
    title: '운전면허 필기 요점',
    subtitle: '표지판과 안전운전 핵심',
    category: '자격증',
    locale: '한국어',
    tier: 'free',
    source: 'ai-batch',
    availability: 'published',
    cardCount: 360,
    tags: ['운전면허', '시험'],
  },
  {
    id: 'it-interview',
    title: 'IT·CS 면접 용어',
    subtitle: '면접 전에 확인할 핵심 개념',
    category: '직무',
    locale: '한국어',
    tier: 'pro',
    source: 'ai-batch',
    availability: 'published',
    cardCount: 420,
    tags: ['IT', '면접', 'CS'],
  },
  {
    id: 'business-english',
    title: '비즈니스 영어 표현',
    subtitle: '회의와 이메일 필수 문장',
    category: '직무',
    locale: '영어',
    tier: 'pro',
    source: 'ai-batch',
    availability: 'published',
    cardCount: 380,
    tags: ['영어', '직무'],
  },
  {
    id: 'world-capitals',
    title: '세계 수도·국기',
    subtitle: '나라와 수도를 한 번에',
    category: '교양',
    locale: '한국어',
    tier: 'free',
    source: 'ai-batch',
    availability: 'published',
    cardCount: 195,
    tags: ['세계', '수도', '국기'],
  },
  {
    id: 'wine-basics',
    title: '와인 기초 용어',
    subtitle: '품종부터 테이스팅까지',
    category: '교양',
    locale: '한국어',
    tier: 'pro',
    source: 'ai-batch',
    availability: 'published',
    cardCount: 220,
    tags: ['와인', '교양'],
  },
  {
    id: 'middle-school-english',
    title: '중학 필수 영단어',
    subtitle: '교과 과정 핵심 어휘',
    category: 'K-12',
    locale: '영어',
    tier: 'free',
    source: 'ai-batch',
    availability: 'published',
    cardCount: 900,
    tags: ['중학교', '영어'],
  },
  {
    id: 'high-school-history',
    title: '고교 한국사 연표',
    subtitle: '내신 대비 시대 흐름',
    category: 'K-12',
    locale: '한국어',
    tier: 'pro',
    source: 'ai-batch',
    availability: 'published',
    cardCount: 410,
    tags: ['고등학교', '한국사'],
  },
] as const;

export const DEMO_CARDS: readonly DaoewoCardView[] = [
  {
    id: 'jp-1',
    deckId: 'jlpt-n5',
    front: '勉強する',
    reading: 'べんきょうする',
    back: '공부하다',
    hint: '무언가를 배우고 익히는 행동',
    example: '毎日、日本語を勉強します。',
    exampleMeaning: '매일 일본어를 공부합니다.',
    tags: ['동사', 'N5'],
    locale: 'ja-JP',
  },
  {
    id: 'jp-2',
    deckId: 'jlpt-n5',
    front: '会議',
    reading: 'かいぎ',
    back: '회의',
    hint: '여러 사람이 모여 의견을 나누는 자리',
    example: '午後に会議があります。',
    exampleMeaning: '오후에 회의가 있습니다.',
    tags: ['명사', 'N5'],
    locale: 'ja-JP',
  },
  {
    id: 'jp-3',
    deckId: 'jlpt-n5',
    front: '提出する',
    reading: 'ていしゅつする',
    back: '제출하다',
    hint: '문서나 과제를 내다',
    example: '明日までに宿題を提出します。',
    exampleMeaning: '내일까지 숙제를 제출합니다.',
    tags: ['동사', 'N5'],
    locale: 'ja-JP',
  },
  {
    id: 'jp-4',
    deckId: 'jlpt-n5',
    front: '約束',
    reading: 'やくそく',
    back: '약속',
    hint: '서로 지키기로 정한 일',
    example: '友だちとの約束を守ります。',
    exampleMeaning: '친구와의 약속을 지킵니다.',
    tags: ['명사', 'N5'],
    locale: 'ja-JP',
  },
  {
    id: 'jp-5',
    deckId: 'jlpt-n5',
    front: '必要',
    reading: 'ひつよう',
    back: '필요',
    hint: '없어서는 안 되는 상태',
    example: '旅行にはパスポートが必要です。',
    exampleMeaning: '여행에는 여권이 필요합니다.',
    tags: ['형용동사', 'N5'],
    locale: 'ja-JP',
  },
] as const;

export const ACTIVE_DECKS = DEMO_DECKS.filter(
  deck => deck.progress !== undefined,
);
