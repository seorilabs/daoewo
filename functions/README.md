# 다외워 Cloud Functions

Cloud Functions v2 TypeScript API다. native 앱은 callable, AppsInToss처럼 callable
SDK를 검증하지 못한 런타임은 동일 계약의 `api` REST endpoint를 사용할 수 있다.
일반 client API는 Firebase Auth와 App Check가 모두 필수다. AIT bootstrap/refresh와
검증된 store webhook만 아래 명시된 별도 서버 권위 경계를 사용한다.
목표·sync·창·진도·요청·영수증·병합 등 mutation callable/REST는 raw Bearer token을
`checkRevoked=true`로 다시 검증하고 callable identity UID와 일치시킨다. 카탈로그와 권한
조회는 Firestore deletion/merge marker를 확인하되 Auth backend 추가 왕복은 하지 않는다.

## API

- `getCatalog`: Free/Pro published metadata와 `locked` 상태
- `createOrResetGoal`, `deactivateGoal`: Free 활성 1개, reset 24시간 cooldown
- `getTodayWindow`: 오늘 배정 + 도래 복습만 전달, premium TTL 24시간
- `submitProgressBatch`: 현재 창 안의 답변만 SRS 권위 상태로 원자적 반영
- `getSyncState`: device policy 확인 후 목표와 압축 progress를 서버에서 pull
- `createDeckRequest`: 일일 rate limit과 Pro 우선순위
- `getEntitlement`, `verifyReceipt`: 서버 검증 권한 경계
- `googlePlaySubscriptionNotification`: Pub/Sub RTDN을 검증하고 Play API 현재 상태로
  entitlement를 회수/복구. topic/config 누락은 predeploy에서 fail-closed
- `appStoreServerNotification`: App Store Server Notifications V2 JWS를 검증하고
  App Store Server API 현재 상태로 entitlement를 회수/복구
- `api`: 위 계약의 `/v1/*` REST adapter
- `api /v1/auth/toss:exchange`: 일회용 authorizationCode + IP 해시 rate limit + mTLS
  provider로 bootstrap하고 Firebase custom auth/App Check token만 반환
  (탈퇴 marker가 있는 deterministic Toss UID에는 token을 발급하지 않음)
- `api /v1/auth/toss:refreshAppCheck`: App Check 만료 시 유효하고 미폐기된 Firebase
  ID token의 `signInProvider=apps-in-toss` claim과 `toss_*` uid를 확인하고 새 App Check
  token+TTL만 반환. user/IP 해시 기준 시간당 rate limit 적용
- `mergeAnonymousAccount`, `api /v1/auth:mergeAnonymous`: source anonymous ID token과
  target Google/Apple ID token을 폐기 여부까지 검증하고 goal/progress/entitlement를
  원자 병합. receipt fingerprint나 primary device 충돌은 fail-closed
- `deleteAccount`, `api /v1/account:delete`: Google/Apple/Toss의 5분 이내 재인증
  (익명은 non-revoked ID token), App Check, `confirmation=DELETE`를 검증하고 account
  deletion marker, 권위 데이터/병합 source 정리, receipt tombstone, Firebase Auth 삭제
  순서로 처리
- `tossSubscriptionWebhook`: 검증된 `subscription.status_changed`만 권한 반영/회수

Pro의 제품 한도는 없다. `600 unique premium cards/user/day`와
`300/device/day` 기본값은 비정상 추출을 잠시 throttling하는 abuse soft-cap이며,
페이월/상품 한도로 표현하지 않는다.

Free 클라우드 pull/push는 최초 사용 시 해시로 바인딩된 `primaryDeviceId` 한 대에서만
가능하다. 목표 생성·비활성화, 오늘 창 발급, progress batch, sync pull이 모두 같은
device policy를 통과한다. Pro는 이 기기 제한을 적용하지 않는다. goal/progress의
Firestore client direct read/write는 차단하며 Functions만 동기화한다.

익명→Google/Apple 병합은 같은 UID로 정상 link된 경우 no-op이고, 다른 UID 충돌이면
카드별 최신 progress·목표·영수증 entitlement를 transaction으로 합친다. receiptClaims
소유권과 자유 입력 deck request는 target UID로 함께 이동하고 source UID에는 merge marker를 남겨 재사용을
차단한다. 양쪽 entitlement fingerprint나 덱 버전이 다르면 부분 병합 없이 거부한다.

스토어의 `obfuscatedExternalAccountId`/`appAccountToken`은 구매 당시 익명 source UID에
묶인 뒤 바뀌지 않는다. 병합 transaction이 만든 `accountMerges/{sourceUid}` marker 중
`sourceUid == doc.id`, `targetUid == 현재 uid`, `billingBindingRetained == true`, `mergedAt`
조건을 모두 만족하는 source만 target의 과거 billing principal allowlist에 포함한다.
다른 target이나 이미 병합된 source는 이 binding을 사용할 수 없다. source Auth 삭제 후에도
활성/복구 가능한 store claim이 남아 있는 동안 merge marker와 receipt claim은 서버 전용
tombstone으로 보존해야 하며, 단순 문서 삭제로 구매를 다른 계정이 재claim하게 하면 안 된다.

Play/App Store receipt provider는 store server API를 서버 권위로 조회한다. 설정이 하나라도
누락되면 해당 provider만 unconfigured fail-closed가 된다. 클라이언트의 package/bundle,
product, transaction/order, expiry, refund/revocation 주장은 권한 근거로 사용하지 않는다.
영수증 fingerprint는 한 uid에만 bind한다.

- Google Play: `purchases.subscriptionsv2.get`으로 현재 상태/상품/만료/계정 식별자를,
  `orders.get`으로 최신 성공 주문의 token/product와 환불 상태를 교차 검증한다. 새 구매는
  서버에서 `purchases.subscriptions.acknowledge`까지 성공해야 권한을 기록한다. Cloud Functions
  runtime service account의 ADC를 사용하며 JSON key를 코드나 앱에 넣지 않는다.
- App Store: production `Get Transaction Info`를 먼저 호출하고 Apple `4040010`일 때만
  sandbox로 재조회한다. Apple 공식 Node library로 transaction/renewal JWS, bundleId,
  appAppleId, productId, appAccountToken, expiry/grace, refund/revocation을 검증한다.
- Google `obfuscatedExternalAccountId`와 Apple `appAccountToken`은 각각
  `googlePlayAccountBinding`/`appStoreAccountBinding`과 같은 값을 구매 시작 시 앱에서
  전달해야 한다. 값이 없거나 현재 Firebase uid와 다르면 권한을 부여하지 않는다.

Google RTDN과 App Store V2 알림은 payload 상태를 그대로 쓰지 않고 각각
`purchases.subscriptionsv2.get`/`Get All Subscription Statuses`를 재조회한다. event 시각은
audit/idempotency에만 쓰고 authoritative API query의 start/response window로 ordering한다.
window가 겹치면 inactive가 이겨 늦은 active 응답이 회수를 되돌리지 않는다. direct receipt
검증도 같은 window를 저장하며 custom claims는 최신 Firestore projection으로 수렴한다.
claim 생성 전 알림은 ACK하지 않고 retry하고, 삭제 tombstone만 성공 종료한다. 다만
persistent fingerprint barrier/claim-only grant hold가 없어 direct commit과 첫 retry 사이의
일시적 Pro 창은 아직 닫히지 않았고 release blocker다. Google
subscription `voidedPurchaseNotification`도 동일 현재-state 경로로 처리하고 one-time void는
ignore한다. voided order가 아직 current latest order면 상태 전파가 끝날 때까지 retry하고,
후속 성공 renewal이 확인된 경우만 active를 유지한다. raw `purchaseToken`, linked token,
`signedPayload`, JWS는 저장·로그하지 않는다.

런타임 설정:

| 이름 | 주입 방식 | 설명 |
| --- | --- | --- |
| `FUNCTIONS_REGION` | deploy env | Functions/Firestore/Storage 지원 리전. local fallback과 별개로 release deploy에는 명시값 필수 |
| `GOOGLE_PLAY_PACKAGE_NAME` | env | 기본값 `com.seorilabs.daoewo` |
| `GOOGLE_PLAY_PRODUCT_IDS` | env CSV | Console 확정 product ID allowlist |
| `GOOGLE_PLAY_RTDN_TOPIC` | deploy param/env | Functions에는 topic ID만 입력. Play Console에는 `projects/<FIREBASE_PROJECT_ID>/topics/<TOPIC_ID>` full resource 입력 |
| `APP_STORE_BUNDLE_ID` | env | 기본값 `com.seorilabs.daoewo` |
| `APP_STORE_APP_APPLE_ID` | env | production App Apple ID |
| `APP_STORE_PRODUCT_IDS` | env CSV | App Store Connect 확정 product ID allowlist |
| `APP_STORE_IAP_ISSUER_ID` / `APP_STORE_IAP_KEY_ID` | env | In-App Purchase key 식별자 |
| `APP_STORE_IAP_PRIVATE_KEY_BASE64` | Secret Manager | `.p8` private key의 base64 |
| `APP_STORE_ROOT_CA_CERTIFICATES_BASE64_JSON` | Secret Manager | Apple PKI root DER의 base64 JSON 배열 |

## Server notification reconciliation 범위

- 최소 실시간 회수는 구현되어 있다. 기존 `receiptClaims/{fingerprint}`가 있는 Google/Apple
  구독만 계정과 연결하며, duplicate/out-of-order/교체 전 receipt/account deletion race를
  transaction에서 다시 검증한다.
- 정상 만료는 저장된 `validUntil` 기준으로 서버 권한 판정에서 자동 종료된다. 실제 RTDN/V2
  endpoint, Pub/Sub IAM, Apple URL, sandbox 환불/갱신 E2E는 Firebase/스토어 설정 후 검증해야 한다.
- Apple은 저장된 `originalTransactionId`로 정기 재조회와 Notification History 복구가
  가능하지만 아직 scheduler/cursor를 구현하지 않았다.
- Google security revoke/refund/chargeback 유실은 Voided Purchases API scheduler가 반환한
  token을 메모리에서 즉시 기존 2단계 fingerprint로 바꾸면 raw token 저장 없이 복구할 수
  있지만 scheduler/cursor/IAM을 아직 구현하지 않았다.
- 누락된 renewal 자동 복구는 Voided Purchases만으로 해결되지 않는다. client reverify 또는
  승인된 KMS token 경계가 필요하며 현재 미구현이다.
- claim 전 notification에는 fingerprint pending marker와 direct claim-only/grant-hold
  2-phase가 없어 transport retry 전 transient grant 가능성이 남는다.
- Google `linkedPurchaseToken` chain은 원자적으로 이전 claim/UID를 supersede해야 한다.
  현재 direct 및 active notification은 fail-closed하고, inactive notification은 현재 claim만
  회수한다. linked old account까지 원자 회수하지 못하므로 release blocker다.
- `store-notification-readiness.json`의 reconciliation/migration/live gate가 모두 true가 되기
  전 `check:release`는 실패한다. 임의 plaintext token 저장은 금지한다.

AppsInToss receipt는 SDK가 보장하는 `orderId`/`sku`를 필수로 받고, callback에 있을 때만
`subscriptionId`를 함께 받는다. 누락된 `subscriptionId`는 partner API가 조회·검증한다.
클라이언트의 `processProductGrant` 성공 주장만으로 entitlement를 쓰지 않는다.
AppsInToss sandbox의 자동갱신 구독 테스트 미지원 때문에 실제 결제/webhook E2E는
콘솔/prod-like 환경 확인 전까지 release blocker다.

공개 AppsInToss 문서는 구독 SDK 상태/웹훅 payload와 서버 API의 mTLS 필요성은 명시하지만,
수신 웹훅을 검증할 서명/header 또는 서버 권위 구독 조회 endpoint 계약은 공개하지 않는다.
따라서 `AppsInTossPartnerProvider`는 콘솔에서 실제 인증 계약과 mTLS 인증서를 확인하기 전까지
unconfigured 상태를 유지한다. webhook JSON body만 신뢰하는 구현은 허용하지 않는다.

AIT RN에는 native App Check attestation이 없어 로그인 교환 route에 선행 App Check를
요구하면 bootstrap 순환이 생긴다. 따라서 이 route만 Auth/App Check 예외이며, 성공한
Toss mTLS identity에 대해 `TOSS_FIREBASE_APP_ID`용 custom App Check token을 발급한다.
appId/provider가 없으면 fail-closed다. 이후 `/v1/*` REST는 Firebase ID token과
`X-Firebase-AppCheck`를 모두 요구한다.

App Check만 먼저 만료된 경우에는 `refreshAppCheck`가 선행 App Check를 요구하지 않는다.
Firebase ID token까지 만료되거나 폐기됐으면 이 route도 401이며 `appLogin()`부터 다시
진행해야 한다. Google/Apple/anonymous 등 다른 Firebase provider는 이 route를 쓸 수 없다.

`pnpm run prepare:deploy`는 config를 검증하고 비밀을 제외한 runtime 값을
`deploy/.env`에 staging한 뒤 Functions JS와 `product-core/dist`를 복사한다. region은
`defineString`, Pub/Sub topic은 CEL parameter로 discovery 시 해석한다. 두 Apple private
값은 계속 `defineSecret`/Secret Manager만 사용한다.
