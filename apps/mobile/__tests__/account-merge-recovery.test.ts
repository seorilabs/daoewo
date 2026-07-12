import { settleAccountMergeAfterTargetSignIn } from '../src/account-merge-recovery';

describe('target Auth 이후 계정 병합 복구', () => {
  it('server와 local 병합이 모두 확인된 경우 complete를 반환한다', async () => {
    const mergeServerState = jest.fn(async () => undefined);
    const mergeLocalState = jest.fn(async () => undefined);

    await expect(
      settleAccountMergeAfterTargetSignIn({
        mergeServerState,
        mergeLocalState,
      }),
    ).resolves.toBe('complete');
    expect(mergeServerState).toHaveBeenCalledTimes(1);
    expect(mergeLocalState).toHaveBeenCalledTimes(1);
  });

  it('callable 응답 유실이어도 local 병합을 완료하고 pending을 반환한다', async () => {
    const mergeServerState = jest.fn(async () => {
      throw new Error('response lost');
    });
    const mergeLocalState = jest.fn(async () => undefined);

    await expect(
      settleAccountMergeAfterTargetSignIn({
        mergeServerState,
        mergeLocalState,
      }),
    ).resolves.toBe('pending');
    expect(mergeLocalState).toHaveBeenCalledTimes(1);
  });

  it('local owner 이동 실패도 target Auth를 실패시키지 않고 pending으로 반환한다', async () => {
    await expect(
      settleAccountMergeAfterTargetSignIn({
        mergeServerState: async () => undefined,
        mergeLocalState: async () => {
          throw new Error('storage unavailable');
        },
      }),
    ).resolves.toBe('pending');
  });
});
