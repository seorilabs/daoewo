/**
 * Firebase provisioning 후 공개 식별자를 채운다. 두 값은 secret이 아니지만,
 * 빈 값인 동안 Toss 로그인과 서버 검증은 의도적으로 fail-closed 된다.
 */
export const APPS_IN_TOSS_RUNTIME_CONFIG = Object.freeze({
  apiBaseUrl: '',
  firebaseApiKey: '',
  legalUrls: Object.freeze({
    terms: '',
    privacy: '',
  }),
});
