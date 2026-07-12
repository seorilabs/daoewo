export type MobileAccountDeletionProof =
  | 'google-reauthentication'
  | 'apple-reauthentication'
  | 'anonymous-valid-token';

export function resolveMobileAccountDeletionProof(input: {
  readonly isAnonymous: boolean;
  readonly providerIds: ReadonlySet<string>;
  readonly platform: 'android' | 'ios' | 'windows' | 'macos' | 'web';
}): MobileAccountDeletionProof {
  if (input.providerIds.has('google.com')) {
    return 'google-reauthentication';
  }
  if (input.platform === 'ios' && input.providerIds.has('apple.com')) {
    return 'apple-reauthentication';
  }
  if (input.isAnonymous) {
    return 'anonymous-valid-token';
  }
  throw new Error('계정 삭제를 위한 재인증 수단을 확인할 수 없어요.');
}
