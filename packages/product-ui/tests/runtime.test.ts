import {createDemoRuntime} from '../src/runtime';

describe('createDemoRuntime', () => {
  it('기기나 네트워크 없이 인증, 저장, 구독 상태를 메모리에 유지한다', async () => {
    const runtime = createDemoRuntime({
      now: () => new Date('2026-07-12T00:00:00.000Z'),
    });

    expect(await runtime.auth.getCurrentUser()).toBeNull();
    const guest = await runtime.auth.continueAsGuest();
    expect(guest.isGuest).toBe(true);

    await runtime.storage.setItem('daily-count', 40);
    expect(await runtime.storage.getItem<number>('daily-count')).toBe(40);

    const entitlement = await runtime.purchase.purchase('annual');
    expect(entitlement.plan).toBe('pro');
    expect(entitlement.billingPlan).toBe('annual');
    expect(runtime.now().toISOString()).toBe('2026-07-12T00:00:00.000Z');
  });
});
