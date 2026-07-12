# Google Play

## App Identity

- Package name: `com.seorilabs.daoewo`
- App name KO: `다외워`
- App name EN: `Daoewo`
- Category: 교육
- Default language: `ko-KR`
- Support email: `cs@seorilabs.com`

## Store Listing

- Short description: 스와이프로 외우고, 틀린 건 다시 보는 나만의 암기 루틴
- Full description: 단어부터 자격증과 개념까지, 목표일까지 매일 분량을 자동 배분하고 스와이프와 간격 반복으로 복습하는 암기 앱. 검수된 큐레이션 덱을 계속 추가하며 필요한 주제는 덱 요청으로 남길 수 있다.
- Icon: `play-store/assets/icon-512.png` (512x512 RGB PNG 생성·치수 검증 완료)
- Feature graphic: `play-store/assets/feature-graphic-1024x500.png` (1024x500 RGB PNG 생성·치수 검증 완료)
- Native splash screen: 인디고 배경 + 다외워 카드/체크 마크 구현
- Phone screenshots: config 기준 **0장**, 승인된 실제 콘텐츠가 보이는 실화면 5장 필요
- 7/10-inch tablet screenshots: config 기준 각각 **0장**, 지원 범위와 자산 `확정 필요`

## Release

- Signing key: org secret + Play App Signing 연결 필요
- Internal testing track: 최초 업로드는 `internal`
- Production rollout policy: 별도 deployment approval 후 staged rollout
- Release notes: `확정 필요`
- AAB gate: `apps/mobile/android/app/build/outputs/bundle/release/app-release.aab`는
  release build job에서 생성·서명·검증한다. gitignored 산출물이므로 checkout-only
  `check:release`는 파일 존재 여부를 검사하지 않는다.

## Policy

- Data safety: 계정, 학습기록, 구매, 앱 활동/분석, 기기 식별자 검토 필요
- Ads declaration: 광고 없음
- App access instructions: `확정 필요`
- Target audience/content rating: v1 13세 이상, IARC/GRAC 콘솔 답변 필요
- Financial/payment features: 디지털 콘텐츠 자동갱신 구독
- Account deletion: 인앱 탈퇴와 별도로 공개 HTTPS 삭제 요청 URL을 Play Console에 등록한다.

## 구독

- `play-store/google-play.config.json`의 월간/연간 상품 ID는 `확정 필요`,
  `apps/mobile/src/runtime-config.ts`의 같은 값은 현재 빈 값이다.
- Functions allowlist `GOOGLE_PLAY_PRODUCT_IDS`도 실제 Console 상품과 같은 값으로 주입해야 한다.
- release checker는 Play/App Store config, mobile runtime, 두 Functions allowlist의 월/연 SKU를
  교차 대조하며 하나라도 다르면 실패한다.
- 월 ₩4,900 / 연 ₩39,000 / 7일 체험은 기획 가격이며 앱은 Play 반환 현지 가격을 표시한다.
- client는 Firebase UID 기반 `obfuscatedExternalAccountId`를 구매에 전달한다. 서버는
  `purchases.subscriptionsv2.get`, `orders.get`, 필요 시 acknowledge를 통과한 결과만 권한으로 쓴다.
- Functions runtime service account에 Android Publisher API 권한이 필요하며, 로컬 key JSON을
  앱이나 저장소에 넣지 않는다.
- Functions env에는 reserved prefix가 아닌 topic ID(예: `daoewo-google-play-rtdn`)만 넣고,
  Play Console에는 `projects/<FIREBASE_PROJECT_ID>/topics/<topic ID>` full resource를 넣는다.
- Play Console RTDN은 **Get notifications for subscriptions and all voided purchases**를 선택하고
  Google Play service agent Publisher IAM 및 **Send Test Message** 수신을 확인한다.
- voided subscription의 `orderId`가 current latest order와 같으면 revoke/expiry 또는 후속
  성공 renewal이 확인될 때까지 retry한다. 과거 renewal이면 과거/current 주문의 token·product를
  Orders API로 각각 교차검증하고 404 eventual consistency를 재시도한다. raw order ID/token은
  저장하지 않고 voided order hash만 audit event에 남긴다.
- `subscriptionsv2.linkedPurchaseToken`은 API 응답 직후 old original ID/fingerprint hash pair로
  치환한다. direct 검증 transaction은 old claim 소유자(동일 UID 또는 검증된 merge target)를
  확인하고 old claim을 `superseded` tombstone으로 바꾸며 new claim·entitlement를 함께 적용한다.
  old-token restore/RTDN은 successor 권한을 변경하지 않고 영구 거부/ACK한다. new-token RTDN은
  API linked hash pair와 new claim predecessor가 정확히 같아야 한다.
- 15분 scheduler가 Voided Purchases API의 최근 29일 window를 6시간 overlap으로 조회한다.
  기존 claim이 있는 subscription token만 현재 `subscriptionsv2`/order 권위 경로로 재검증하고,
  raw token은 cursor/event에 저장하지 않는다. page token이 만료되면 같은 고정 window의 첫
  페이지로 원자 reset한 뒤 재시도한다.
- 비익명 mobile 계정은 서버가 Free를 반환한 앱 세션에 한 번 현재 스토어 구매를 재검증해
  누락된 renewal을 복구한다. 실패는 Free startup을 막지 않는다.

## 현재 Blocker

- support/privacy 공개 HTTPS URL 미확정, mobile `legalUrls`도 빈 값
- 외부 계정 삭제 요청 URL(`accountDeletionUrl`) 미확정
- `googleWebClientId`, 월/연 상품 ID, `GOOGLE_PLAY_PRODUCT_IDS` 미설정
- Firebase project와 `google-services.json` 미생성
- Data safety/IARC/GRAC/App access와 실제 screenshot 미완료
- 영수증 sandbox·복원·환불·결제 보류 E2E 미완료
- Google RTDN/voided 및 Voided Purchases scheduler/cursor 코드 경로는 구현됐으나
  topic/runtime IAM/Test Message/scheduler 실행·환불 E2E 미검증
- `linkedPurchaseToken` 원자 migration은 구현·emulator 검증 완료, Play sandbox의
  upgrade/downgrade/re-signup 및 unrelated account 공격 E2E 미검증
- mobile missed-renewal client reverify는 구현됐으나 Play sandbox 자동 복구 E2E 미검증

공식 문서:

- https://developer.android.com/google/play/billing/subscriptions
- https://developer.android.com/google/play/billing/security
- https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2
- https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.voidedpurchases/list
