export interface MobileRuntimeConfig {
  readonly firebaseEnabled: boolean;
  readonly functionsRegion: string;
  readonly googleWebClientId: string;
  readonly subscriptionProductIds: {
    readonly monthly: string;
    readonly annual: string;
  };
  readonly legalUrls: {
    readonly terms: string;
    readonly privacy: string;
  };
}

/**
 * Firebase 앱 등록과 스토어 상품 생성 후 공개 식별자를 채운다.
 * 빈 값인 동안 앱은 Free-only local runtime으로 동작하고 결제는 fail-closed 된다.
 */
export const MOBILE_RUNTIME_CONFIG: MobileRuntimeConfig = Object.freeze({
  firebaseEnabled: false,
  functionsRegion: 'asia-northeast3',
  googleWebClientId: '',
  subscriptionProductIds: Object.freeze({
    monthly: '',
    annual: '',
  }),
  legalUrls: Object.freeze({
    terms: '',
    privacy: '',
  }),
});
