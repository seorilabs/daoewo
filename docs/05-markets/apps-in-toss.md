# AppsInToss

## App Identity

- appName: `daoewo` (Console 중복 확인 필요)
- Korean display name: `다외워`
- English display name: `Daoewo`
- Category: 교육
- Support email: `cs@seorilabs.com`

## Runtime

- Framework: Granite React Native
- TDS: `@toss/tds-react-native`
- Entry scheme: `intoss://daoewo/`
- Local storage: AppsInToss `Storage` 우선
- `apiBaseUrl`: 현재 빈 값
- `firebaseApiKey`: 현재 빈 값
- `legalUrls.terms` / `privacy`: 현재 빈 값

위 값이 비어 있는 동안 Toss 로그인·App Check bootstrap·서버 콘텐츠·구독·약관 링크는
fail-closed 되고 Free local 기능만 유지한다.

## Registration

- Logo 600x600: `apps-in-toss/assets/logo-600.png` (RGB PNG 생성·치수 검증 완료)
- Thumbnail 1932x828: `apps-in-toss/assets/thumbnail-1932x828.png` (RGB PNG 생성·치수 검증 완료)
- Vertical screenshots 636x1048: config 기준 **0장**, 실제 화면 최소 3장·기획 5장 필요
- Brand color: `#4C6FFF` 구현 기준
- Initial route branding: 다외워 온보딩, Granite 데모 제거
- Public icon URL / Terms / Privacy: `확정 필요`. 현재 icon은 `placehold.co`라 blocker다.

## Release

- `.ait` artifact: `apps/ait/daoewo.ait`
- Sandbox QA device: `확정 필요`
- Console review fields: `확정 필요`
- Ads/payment policy answers: 광고 없음. 자동갱신 구독 연동 대상

## 신규·요청 덱 Smart Message

mobile의 FCM 설치/token/outbox 경로는 Android/iOS 스토어 앱 전용이다. AppsInToss에서는 이를
재사용하거나 fallback으로 간주하지 않고, 공식 Smart Message client API와 partner server API를
별도 adapter로 연결한다.

현재 `@apps-in-toss/framework` 2.10.5는 `requestNotificationAgreement`의 SDK 2.5.0+ 조건을
충족한다. 그러나 AIT runtime은 `createUnsupportedDaoewoDeckReadyNotifications()`를 사용하고,
Console `templateSetCode`, partner mTLS 발송 provider, 실제 Toss App E2E가 모두 미설정이다.
따라서 설정의 신규·요청 덱 알림은 fail-closed 상태이며 release blocker다.

- 요청 덱 준비: 기능성 캠페인 후보. 알림 동의문 연결, 문구 검수, `templateSetCode` 승인 후에만
  `requestNotificationAgreement`를 노출한다.
- 신규 덱 공개: 서비스 이용 유도 성격이므로 기능성 메시지로 가정하지 않는다. 광고성 분류,
  마케팅 수신 동의, 캠페인 정책을 Console에서 승인받지 못하면 발송하지 않는다.
- server: `x-toss-user-key`와 사용자 계정 매핑, mTLS 인증서, `/messenger/send-message` provider,
  멱등성·재시도·빈도 제한이 필요하다. 인증서와 user key는 client·문서·로그에 남기지 않는다.
- QA: 승인된 template과 업로드 bundle `deploymentId`로 test message를 발송하고 iOS/Android 실제
  Toss App에서 푸시/알림함, 수신 해제, 딥링크, 중복 방지를 검증한다.

repo-local 외부 게이트는 `docs/06-release/release-checklist.md`의
`AIT_SMART_MESSAGE_*` 항목으로 추적한다. 세 항목이 모두 `[x]`가 되기 전에는
`pnpm run check:release`가 실패하는 것이 정상이다.

## 구독·로그인

- 2026-07-12 공식 문서 확인: React Native SDK v1.12.0부터 `IAP.createSubscriptionPurchaseOrder`, `getSubscriptionInfo`, webhook, pending order 복구를 지원한다.
- 최소 Toss App: iOS 5.250.0 / Android 5.253.0. 구버전에서 API가 `undefined`면 구매 CTA를 숨기고 Free 기능을 유지한다.
- 현재 Sandbox App은 구독 테스트를 지원하지 않는다. 상품/실결제 검증 없이 완료 처리하지 않는다.
- `appLogin()` authorization code는 10분/일회성이며 mTLS 서버에서 token 교환한다. Access/Refresh token과 mTLS 키는 client에 저장하지 않는다.
- 구매 grant는 orderId를 서버가 검증한 뒤 entitlement를 반영하고 `completeProductGrant`를 호출한다. webhook 갱신/해지/환불도 서버에서 동기화한다.
- client SDK의 상품 조회·주문·pending recovery seam은 구현되어 있다. 다만 Functions의
  `AppsInTossPartnerProvider`와 receipt provider는 official partner 인증 계약·mTLS 인증서를
  연결하기 전까지 의도적으로 unconfigured/fail-closed다.
- 공개 공식 문서에는 SDK 구독 상태·웹훅 payload가 있지만, 이 repo가 서버 권위로 신뢰할
  partner 조회/웹훅 인증 구현은 아직 연결되지 않았다. 웹훅 JSON이나 client callback만으로
  Pro를 지급하지 않는다.

## 주의

`.ait` build 성공은 console 등록, sandbox QA, 이미지, 광고, 심사 준비 완료를 의미하지 않는다.
최초 route에서 framework template 화면이나 빈 화면이 먼저 보이면 release blocker로 본다.

공식 문서:

- IAP 정기결제: https://developers-apps-in-toss.toss.im/bedrock/reference/framework/%EC%9D%B8%EC%95%B1%20%EA%B2%B0%EC%A0%9C/subscription.html
- IAP/mTLS 주문 상태 조회: https://developers-apps-in-toss.toss.im/bedrock/reference/framework/%EC%9D%B8%EC%95%B1%20%EA%B2%B0%EC%A0%9C/IAP.html
- Smart Message 개발: https://developers-apps-in-toss.toss.im/smart-message/develop.html
- Smart Message QA: https://developers-apps-in-toss.toss.im/smart-message/qa.html
