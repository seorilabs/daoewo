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
    let serverMutationCommitted = false;
    const mergeServerState = jest.fn(async () => {
      serverMutationCommitted = true;
      throw new Error('response lost');
    });
    const mergeLocalState = jest.fn(async () => undefined);

    await expect(
      settleAccountMergeAfterTargetSignIn({
        mergeServerState,
        mergeLocalState,
      }),
    ).resolves.toBe('pending');
    expect(serverMutationCommitted).toBe(true);
    expect(mergeServerState).toHaveBeenCalledTimes(1);
    expect(mergeLocalState).toHaveBeenCalledTimes(1);
  });

  it('server와 local 병합을 서로 기다리지 않고 병렬로 시작한다', async () => {
    const started: string[] = [];
    let releaseServer!: () => void;
    const serverRelease = new Promise<void>(resolve => {
      releaseServer = resolve;
    });
    let releaseLocal!: () => void;
    const localRelease = new Promise<void>(resolve => {
      releaseLocal = resolve;
    });

    const pending = settleAccountMergeAfterTargetSignIn({
      mergeServerState: async () => {
        started.push('server');
        await serverRelease;
      },
      mergeLocalState: async () => {
        started.push('local');
        await localRelease;
      },
    });

    await Promise.resolve();
    expect(started).toEqual(['server', 'local']);
    releaseLocal();
    releaseServer();
    await expect(pending).resolves.toBe('complete');
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
