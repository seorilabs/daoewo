import type { DaoewoUser } from '@daoewo/product-ui';

export type AccountMergeStatus = NonNullable<DaoewoUser['accountMergeStatus']>;

/**
 * 대상 계정 Auth가 확정된 뒤의 merge는 로그인 성공 여부와 분리한다.
 * callable 응답 유실처럼 완료 여부가 모호하면 target을 유지하고 pending으로 반환한다.
 */
export async function settleAccountMergeAfterTargetSignIn(input: {
  readonly mergeServerState: () => Promise<void>;
  readonly mergeLocalState: () => Promise<void>;
}): Promise<AccountMergeStatus> {
  const results = await Promise.allSettled([
    Promise.resolve().then(input.mergeServerState),
    Promise.resolve().then(input.mergeLocalState),
  ]);
  return results.every(result => result.status === 'fulfilled')
    ? 'complete'
    : 'pending';
}
