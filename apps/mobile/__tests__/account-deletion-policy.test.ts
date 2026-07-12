import {resolveMobileAccountDeletionProof} from '../src/account-deletion-policy';

describe('mobile account deletion proof', () => {
  test.each([
    ['google', false, ['google.com'], 'android', 'google-reauthentication'],
    ['apple', false, ['apple.com'], 'ios', 'apple-reauthentication'],
    ['anonymous', true, [], 'android', 'anonymous-valid-token'],
  ] as const)(
    '%s 계정의 안전한 소유 증명을 선택한다',
    (_name, isAnonymous, providerIds, platform, expected) => {
      expect(
        resolveMobileAccountDeletionProof({
          isAnonymous,
          providerIds: new Set(providerIds),
          platform,
        }),
      ).toBe(expected);
    },
  );

  test('현재 플랫폼에서 재인증할 수 없는 provider는 fail-closed 처리한다', () => {
    expect(() =>
      resolveMobileAccountDeletionProof({
        isAnonymous: false,
        providerIds: new Set(['apple.com']),
        platform: 'android',
      }),
    ).toThrow('재인증 수단');
  });
});
