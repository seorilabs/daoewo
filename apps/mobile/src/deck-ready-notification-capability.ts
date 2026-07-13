import type { DaoewoDeckReadyNotificationAvailability } from '@daoewo/product-ui';

export function resolveDeckReadyNotificationAvailability(input: {
  readonly remoteConfigResolved: boolean;
  readonly pushEnabled: boolean;
}): DaoewoDeckReadyNotificationAvailability {
  if (!input.remoteConfigResolved) {
    return 'resolving';
  }
  return input.pushEnabled ? 'available' : 'disabled-by-config';
}
