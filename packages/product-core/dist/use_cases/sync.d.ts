import type { CardProgress } from '../domain/entities.js';
import type { LearningBackupSnapshot, LearningSyncSnapshot } from '../domain/sync.js';
export declare const EMPTY_LEARNING_BACKUP_SNAPSHOT: LearningBackupSnapshot;
export declare function mergeLearningBackupSnapshots(first: LearningBackupSnapshot, second: LearningBackupSnapshot, allowMultipleActiveDecks?: boolean): LearningBackupSnapshot;
export declare function mergeLearningSyncSnapshots(first: LearningSyncSnapshot, second: LearningSyncSnapshot, allowMultipleActiveDecks?: boolean): LearningSyncSnapshot;
export declare function mergeCardProgresses(first: readonly CardProgress[], second: readonly CardProgress[]): readonly CardProgress[];
//# sourceMappingURL=sync.d.ts.map