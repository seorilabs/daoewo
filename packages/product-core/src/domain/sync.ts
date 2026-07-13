import type {CardProgress, StudyGoal} from './entities.js';
import type {LocalDateKey} from './date-key.js';

export interface LearningSessionSnapshot {
  readonly id: string;
  readonly deckId: string;
  readonly date: LocalDateKey;
  readonly target: number;
  readonly completed: number;
  readonly known: number;
  readonly unknown: number;
  readonly reviewCount: number;
  readonly elapsedMs: number;
  readonly completedAt: string;
}

export interface FreeDeckProgressSnapshot {
  readonly cardIndex: number;
  readonly state: CardProgress;
}

export interface FreeDeckLearningSnapshot {
  readonly deckId: string;
  readonly deckVersion: number;
  readonly active: boolean;
  readonly goal: StudyGoal | null;
  readonly progresses: readonly FreeDeckProgressSnapshot[];
}

/**
 * 서버 backup wire payload다. 카드 본문, UID, device 식별자와 Pro 진도는 포함하지 않는다.
 */
export interface LearningBackupSnapshot {
  readonly version: 1;
  readonly freeDecks: readonly FreeDeckLearningSnapshot[];
  readonly sessions: readonly LearningSessionSnapshot[];
}

/** pull 응답의 backup과 서버 권위 Pro 진도를 UI에 함께 전달하는 client-side snapshot이다. */
export interface LearningSyncSnapshot {
  readonly backup: LearningBackupSnapshot;
  readonly authoritativeProgresses: readonly CardProgress[];
}
