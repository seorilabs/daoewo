import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

export interface Spec extends TurboModule {
  requestPermission(): Promise<boolean>;
  applyPreferences(
    dailyReminder: boolean,
    reviewReminder: boolean,
    nextReviewAtEpochMs: number,
  ): Promise<void>;
  clear(): Promise<void>;
}

export default TurboModuleRegistry.get<Spec>('NativeDaoewoNotifications');
