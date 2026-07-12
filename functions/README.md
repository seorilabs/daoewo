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
- `getSyncState`: device policy 확인 후 목표·압축 progress·Free backup revision을 pull
- `syncLearningBackup`: 본문 없는 Free 목표/progress·세션 snapshot을 revision/mutation ID로
  결정적 merge. Free primary device 한 대, Pro 다기기 허용
- `createDeckRequest`: 일일 rate limit과 Pro 우선순위
- `completeDeckRequest`: 폐기 확인·App Check와 `operator=true` custom claim을 요구하고 published
  덱만 요청에 원자 연결. 같은 덱 재호출은 멱등이며 사용자 입력의 상태/revision은 받지 않고
  응답에도 requester UID/topic/note를 반환하지 않음
- `registerNotificationInstallation`, `unregisterNotificationInstallation`: mobile FCM 설치를
  Auth + App Check + 폐기 확인 경계에서 등록/해제. 응답에는 UID/token/device 식별자를 넣지 않음
- `enqueueDeckReadyNotification`: `deckRequests/{requestId}`의 유효한 `queued → ready` 전환을
  revision 기반 결정적 `notificationOutbox` 문서로 변환
- `processDeckReadyNotificationOutbox`: 현재 요청 소유자와 활성 설치를 다시 확인해 고정 문구의
  덱 준비 FCM만 발송하고 invalid token 정리·제한 재시도를 수행
- `sendCatalogPublishedNotification`: `decks/{deckId}`가 최초 `published`가 될 때 durable event
  lease를 선점하고 현재 opt-in 설치에 고정 문구의 신규 덱 FCM을 multicast. deck ID·제목·본문은
  device payload에 포함하지 않으며 계정 삭제된 설치는 조회되지 않음
- `getEntitlement`, `verifyReceipt`: 서버 검증 권한 경계
- `googlePlaySubscriptionNotification`: Pub/Sub RTDN을 검증하고 Play API 현재 상태로
  entitlement를 회수/복구. topic/config 누락은 predeploy에서 fail-closed
- `appStoreServerNotification`: App Store Server Notifications V2 JWS를 검증하고
  App Store Server API 현재 상태로 entitlement를 회수/복구
- `googlePlayVoidedPurchaseReconciliation`: Voided Purchases API 누락 event를 15분 scheduler로 복구
- `appStoreProductionNotificationHistoryReconciliation` /
  `appStoreSandboxNotificationHistoryReconciliation`: 실패한 V2 delivery history를 현재 상태로 복구
- `api`: 위 계약의 `/v1/*` REST adapter
- `api /v1/auth/toss:exchange`: 일회용 authorizationCode + IP 해시 rate limit + mTLS
  provider로 bootstrap하고 Firebase custom auth/App Check token만 반환
  (탈퇴 marker가 있는 deterministic Toss UID에는 token을 발급하지 않음)
- `api /v1/auth/toss:refreshAppCheck`: App Check 만료 시 유효하고 미폐기된 Firebase
  ID token의 `signInProvider=apps-in-toss` claim과 `toss_*` uid를 확인하고 새 App Check
  token+TTL만 반환. user/IP 해시 기준 시간당 rate limit 적용
- `mergeAnonymousAccount`, `api /v1/auth:mergeAnonymous`: source anonymous ID token과
  target Google/Apple ID token을 검증하고 goal/progress/entitlement를 원자 병합. 신규
  병합은 source 폐기 여부와 Admin Auth의 현재 `providerData=[]`까지 확인해 stale anonymous
  token으로 이미 linked된 계정을 삭제하지 못하게 한다. 응답 유실 재호출은 exact
  source→target v2 marker의 저장 결과만 멱등 반환. receipt fingerprint나 primary device
  충돌은 fail-closed
- `processAccountMergeCleanup`: v2 merge marker 생성 trigger가 5분 lease를 선점해 source
  refresh token 폐기/Auth 삭제와 target entitlement custom claim 투영을 멱등 재시도. callable
  commit과 분리되어 post-commit Auth 장애가 이미 완료된 병합을 실패 응답으로 바꾸지 않음
- `accountMergeCleanupReconciliation`: 15분마다 oldest-first 최대 50개의 5분 이상 지난
  `pending/failed/claimed` marker를 다시 처리. onCreate 배포 전 marker와 Eventarc 재시도 종료
  누락을 복구하며 인스턴스/동시성은 각각 1로 제한
- `deleteAccount`, `api /v1/account:delete`: Google/Apple/Toss의 5분 이내 재인증
  (익명은 non-revoked ID token), App Check, `confirmation=DELETE`를 검증하고 account
  deletion marker, 권위 데이터/병합 source 정리, receipt tombstone, Firebase Auth 삭제
  순서로 처리
- `tossSubscriptionWebhook`: 검증된 `subscription.status_changed`만 권한 반영/회수

Pro의 제품 한도는 없다. `600 unique premium cards/user/day`와
`300/device/day` 기본값은 비정상 추출을 잠시 throttling하는 abuse soft-cap이며,
페이월/상품 한도로 표현하지 않는다.

Free 클라우드 pull/push는 최초 사용 시 해시로 바인딩된 `primaryDeviceId` 한 대에서만
가능하다. 목표 생성·비활성화, 오늘 창 발급, progress batch, sync pull/push가 모두 같은
device policy를 통과한다. Pro는 이 기기 제한을 적용하지 않는다. Free backup은 카드 본문·UID·
device 식별자 없이 덱/version, 목표, card index/ID별 압축 progress와 세션 요약만 저장한다.
goal/progress/sync의 Firestore client direct read/write는 차단하며 Functions만 동기화한다.

익명→Google/Apple 병합은 같은 UID로 정상 link된 경우 no-op이고, 다른 UID 충돌이면
카드별 최신 progress·목표·영수증 entitlement를 transaction으로 합친다. receiptClaims
소유권과 자유 입력 deck request는 target UID로 함께 이동하고 source UID에는 merge marker를 남겨 재사용을
차단한다. v2 marker에는 민감정보 없이 count/entitlement 이동 여부와 cleanup
`pending/claimed/failed/complete`, attempt, 5분 lease만 기록한다. source Auth 폐기와 target custom
claim 투영은 retry trigger가 수행하며, 같은 source→target 재호출은 marker의 결과를 반환한다.
계정 소유 쓰기 transaction은 deletion marker와 merge marker를 함께 읽으므로 외부 active
검사 직후 병합이 commit되어도 source goal/progress/window/request를 다시 만들 수 없다.
양쪽 entitlement fingerprint나 덱 버전이 다르면 부분 병합 없이 거부한다.

notification installation도 병합 transaction에서 `lastSeenAt` 최신순 계정 합산 10개만 target
UID로 이동하고 계정 삭제 시 현재/병합 source UID 범위에서 제거한다. outbox는 수신자 UID를
저장하지 않으므로 발송 직전에 권위 request의
현재 UID를 다시 해석한다. outbox와 로그·callable 응답에는 raw FCM token, UID, topic, note를 넣지
않는다. FCM 표시 payload도 고정 제목/본문과 `kind=deck-ready` 또는
`kind=catalog-published`만 사용하고 request/deck ID는 전송하지 않는다. 일일 학습/복습 알림은 기기 로컬 스케줄러의 책임이며 Functions scheduler를
추가하지 않는다.

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
claim 생성 전 알림은 fingerprint authority barrier를 같은 transaction에서 만들고 retry한다.
direct 검증은 claim만 확정하고 Free로 보류하며, 후속 알림이 store 현재 상태와 event를
commit하면서 barrier를 지운 뒤에만 Pro를 연다. Google
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

- 실시간 RTDN/V2와 scheduled reconciliation은 기존 `receiptClaims/{fingerprint}`가 있는
  Google/Apple 구독만 계정과 연결하고, duplicate/out-of-order/linked/account-deletion race를
  transaction에서 다시 검증한다. 정상 만료는 저장된 `validUntil`로도 자동 종료된다.
- Google scheduler는 최근 29일 Voided Purchases를, Apple production/sandbox scheduler는 각각
  179일/29일 실패 history를 15분마다 6시간 overlap으로 읽는다. Apple JWS는 메모리에서 검증하고
  두 경로 모두 현재 store 상태를 다시 조회한다.
- cursor는 고정 window와 vendor page token만 저장한다. page 처리 실패 전에는 전진하지 않고,
  token 만료/무효 시 같은 window 첫 페이지로 원자 reset한다. raw purchase token, voided order,
  transaction ID, signed JWS는 cursor/event/log에 저장하지 않는다. 첫 페이지 window가 vendor
  최대 lookback 밖으로 밀리면 새 bounded window를 열고 abandonment count/time만 남긴다.
- 누락 renewal은 비익명 mobile 계정이 서버 Free 응답을 받은 앱 세션에 한 번 현재 구매를
  `verifyReceipt`로 다시 보내 복구한다. 실패해도 Free startup과 로컬 학습을 유지한다.
- Google `linkedPurchaseToken`은 즉시 hash pair로 치환한다. old claim supersede, new claim,
  entitlement를 한 transaction으로 쓰고 old restore/RTDN을 차단한다.
- 실제 RTDN/V2 endpoint, scheduler runtime IAM, sandbox 환불·갱신·linked·client-reverify E2E는
  Firebase/스토어 설정 후 검증한다. `store-notification-readiness.json`의 `liveVerified`가
  모두 true가 되기 전 `check:release`는 실패한다.

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
