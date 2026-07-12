import {createStoreAccountBinding} from '../src/store-account-binding';

describe('store account binding', () => {
  it('원본 UID를 노출하지 않고 스토어별 결정적 형식을 만든다', () => {
    const first = createStoreAccountBinding('user-a');
    const second = createStoreAccountBinding('user-a');

    expect(first).toEqual(second);
    expect(first).toEqual({
      googleObfuscatedAccountId:
        'cbd4631b51079c0cefe2b0dbfbf098fc6ea8333ff889bea1a136d5366888d89c',
      appleAppAccountToken: '66589c23-2af2-5a68-8e99-8b602e5cefc3',
    });
    expect(JSON.stringify(first)).not.toContain('user-a');
  });

  it('빈 UID는 구매 바인딩을 만들지 않는다', () => {
    expect(() => createStoreAccountBinding('   ')).toThrow(
      '구매 계정 식별자를 확인할 수 없어요.',
    );
  });
});
