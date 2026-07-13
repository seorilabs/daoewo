# Firebase

## Project Strategy

- Firebase project ID: 프로비저닝 전
- Shared project or app-specific project: 전용 project 권장(구독·Auth·콘텐츠 권위·비용 격리)
- Region: 한국 사용자 latency와 Functions/Storage 동시 지원 리전 확인 후 확정
- Billing plan: Functions/Storage 사용 때문에 Blaze 필요

현재 `firebase/.firebaserc`, Android `google-services.json`, iOS
`GoogleService-Info.plist`가 없다. mobile `firebaseEnabled=false`, AIT `apiBaseUrl`과
`firebaseApiKey`도 빈 값이므로 Firebase 의존 기능은 의도적으로 fail-closed다.

## Services

| Service | 사용 여부 | 비고 |
| --- | --- | --- |
| Auth | 예 | 익명 시작, Google/Apple 연결, 탈퇴 |
| Firestore | 예 | 목표·압축 progress·entitlement·카탈로그 메타·요청 |
| Storage | 예 | 버전드 덱 콘텐츠 200장 청크, 향후 미디어 |
| Cloud Functions / Run | 예 | 세션 전달·진도·요청·영수증·운영 배치 |
| Remote Config | 예 | mobile 카탈로그 cache TTL·신규·요청 덱 push kill-switch만, 보안 권위로 사용 금지 |
| Analytics | 예 | `memo_*` funnel |
| Crashlytics | 예 | mobile 고정 operation/surface/error code만, 사용자 ID·raw Error 제외 |
| Performance | 초기 제외 | 병목 근거가 생기면 추가 |
| FCM | 예 | mobile 신규·요청 덱 알림 전용, 일일/복습은 local scheduler. AIT에는 적용하지 않음 |
| App Check | 예 | mobile provider와 AIT 호환 경로를 각각 검증 |

## Rules

- Firestore rules: `firebase/firestore.rules`
- Firestore indexes: `firebase/firestore.indexes.json`
- Storage rules: `firebase/storage.rules`

## Security

- service account JSON과 private key는 client app에 포함하지 않는다.
- Firebase API key와 app ID는 식별자지만, release docs와 CI secret ownership은 분리해서 관리한다.
- 공유 Firebase project를 쓰면 `app_id`, path prefix, tenant field, custom claims 등으로 앱 경계를 명확히 한다.

## Mobile Remote Config / Observability

배포 템플릿은 `firebase/remoteconfig.template.json`이며 모바일 local defaults와 자동 대조한다.
허용 key는 `mobile_catalog_cache_ttl_minutes`(5~1440분, 기본 60)와
`mobile_deck_updates_push_enabled`(기본 false)뿐이다. 전자는 이미 검증한 카탈로그 cache의
재사용 시간만 바꾸고, 후자는 구현된 push 경로를 끄는 kill-switch다. entitlement, Free/Pro
한도, receipt, App Check 판정은 Remote Config에서 결정하지 않는다.

Crashlytics app adapter가 추가하는 custom 진단은 allowlist된 operation/surface/error code와
platform/build뿐이며 UID, 이메일, 카드·요청 본문, token, provider 원본 오류를 받지 않는다.
다만 Crashlytics native SDK 자체는 crash stack·관련 app state·기기/OS를 수집한다. raw JS crash
자동 변환은 `apps/mobile/firebase.json`에서 끄고, 로그아웃·탈퇴 시 user context를 빈 값으로
정리하며 App Store privacy 원장에는 native 기본 수집까지 반영한다.

## Runtime / Secret Inventory

Firebase 프로젝트 확정 후 repo 공개 config와 Functions 런타임을 함께 맞춘다. secret 값은
출력·문서화·커밋하지 않고 Secret Manager 또는 runtime identity에만 둔다.

| 경계 | 필요한 값 | 현재 |
| --- | --- | --- |
| mobile | Firebase native config, `googleWebClientId`, 월/연 product ID, legal URLs | 미설정 |
| AIT | `apiBaseUrl`, `firebaseApiKey`, `TOSS_FIREBASE_APP_ID`, legal URLs | 미설정 |
| Functions deployment | `FUNCTIONS_REGION` 명시값 | 리전 확정 전. local fallback `asia-northeast3`만으로 release deploy 금지 |
| Content operator | Firebase Auth `operator=true` custom claim 계정과 claim 발급·회수 절차 | callable/service 구현, 실제 운영 계정·E2E 미검증 |
| Google Play receipt/RTDN | product allowlist, Functions topic ID, Play Console full topic resource, Publisher IAM, Android Publisher runtime IAM | RTDN/Voided scheduler·client reverify 구현, 값/IAM/Test Message 미검증 |
| App Store receipt env | `APP_STORE_APP_APPLE_ID`, `APP_STORE_PRODUCT_IDS`, `APP_STORE_IAP_ISSUER_ID`, `APP_STORE_IAP_KEY_ID` | 미설정 |
| App Store receipt secret | `APP_STORE_IAP_PRIVATE_KEY_BASE64`, `APP_STORE_ROOT_CA_CERTIFICATES_BASE64_JSON` | Secret Manager 미검증 |
| App Store V2 callback | `appStoreServerNotification` HTTPS URL을 production/sandbox Server Notifications V2 URL로 등록 | callback/History scheduler 구현, URL/IAM/E2E 미검증 |
| AppsInToss partner | mTLS identity/receipt·webhook 검증 provider | unconfigured, fail-closed |
| AppsInToss Smart Message | Console 동의문/캠페인 `templateSetCode`, `x-toss-user-key` 매핑, server mTLS provider | unconfigured, fail-closed. mobile FCM과 별도 gate |

`pnpm run check:release`는 secret 값을 받거나 출력하지 않고 GitHub가 계산한 configured marker와
Functions `defineSecret` wiring만 검사한다. 실제 Secret Manager version, runtime service account
IAM, provider 인증서는 Firebase 프로젝트가 생긴 뒤 원격 상태로 다시 검증한다.

Google RTDN과 App Store V2 callback은 claim UID를 찾은 뒤 store API 현재 상태를 재조회한다.
event cursor가 아니라 API query start/response window가 권위 ordering이며 overlap은 inactive가
이긴다. claim 전 알림은 `receiptAuthorityBarriers/{receiptFingerprint}`를 claim 조회와 같은
transaction에서 만든 뒤 retry한다. marker에는 platform·관측 시각·횟수만 있으며 raw
purchase/transaction ID, token, JWS, UID, product/event ID를 저장하지 않는다. direct 검증은
같은 marker를 읽어 claim만 확정하고 Free projection으로 grant를 보류한다. 후속 알림은 store
현재 상태와 event를 반영하고 marker를 한 transaction에서 지운다. 계정 병합 중에는 marker를
유지해 이동된 claim UID로 재처리하고, 탈퇴 tombstone 전환 시에는 같은 transaction에서
제거한다. Google voided subscription도 처리하며 raw purchase/linked token과 Apple JWS는
비저장·비로그다.

Google replacement/re-signup은 `linkedPurchaseToken`을 API 응답 즉시 old hashed original
ID/fingerprint로 변환한다. direct receipt transaction이 old/new claim 소유권과 merge target을
확인하고 old claim을 `superseded` tombstone으로 전환하며 new claim·entitlement를 함께 쓴다.
old-token restore/RTDN은 권한을 열거나 현재 successor를 회수하지 않는다. new-token RTDN의
API linked hash와 claim predecessor가 다르면 적용하지 않는다. account deletion은 두 claim의
chain metadata와 UID를 지우고 기존 account-deleted tombstone으로 전환한다.

Apple Notification History와 Google Voided Purchases는 15분 scheduler, overlap window,
Firestore cursor와 pagination-token reset까지 구현했다. history payload는 기존 claim이 있는
구독만 현재 store API로 재조회하고 raw token/JWS는 저장하지 않는다. mobile은 비익명 계정의
서버 권한이 Free일 때 세션당 한 번 현재 구매를 재검증해 누락 renewal을 복구한다.

남은 release blocker는 scheduler runtime IAM/실행, pre-claim sandbox race, missed-renewal
sandbox 자동 복구, Google linked upgrade/downgrade/re-signup E2E다. repo 원장은
`functions/store-notification-readiness.json`이며 live IAM/endpoint 검증까지 false인 동안
`check:release`가 실패한다. Google topic Publisher/Test Message와 Functions runtime의
Android Publisher API IAM, Apple outer callback과 status API/nested JWS E2E는 별도 gate다.

## 데이터 경계

- `decks`: 잠금 포함 카탈로그 메타 읽기 가능
- `deckContent` 및 Storage의 Pro 청크: client 직접 read deny, Admin/Functions 전용
- `users/{uid}/goals`, `deckProgress`: client direct read/write deny, Functions sync API만 사용
- `users/{uid}/entitlements`: 본인 read, Functions/Admin만 write
- `receiptAuthorityBarriers`: fingerprint-keyed claim 전 권위 장벽, Admin/Functions만 read/write
- `deckRequests`: 본인 create/read, 운영 상태는 Functions/Admin만 변경
- `notificationInstallations`, `notificationOutbox`: client direct read/write deny, Auth + App Check +
  폐기 확인 callable과 Admin trigger만 접근
- Free backup은 서버에 기록된 `primaryDeviceId` 한 대만 허용, Pro는 다기기 허용

## 계정 삭제

- `deleteAccount` / `POST /v1/account:delete`: Auth + App Check + `DELETE` 확인값을 요구한다.
  Google/Apple/Toss는 5분 이내 재인증, 익명 계정은 폐기 여부를 확인한 유효 ID token을
  소유 증명으로 사용한다. 익명 탈퇴를 위해 새 UID를 만들지 않는다.
- 삭제 순서: `accountDeletions/{uid}` marker → 현재/병합 source UID 권위 데이터 정리 →
  receipt claim 비식별 tombstone + 연결된 authority barrier 원자 제거 → Firebase Auth user
  삭제(마지막).
- 병합 source blocker는 target 탈퇴 시 atomic batch로 영구 최소 deletion tombstone으로
  전환한다. target 연결 값은 source tombstone에 남기지 않는다. 이 보존 예외는 폐기 실패한
  Auth/refresh token을 포함한 UID resurrection 차단 목적이다.
- 앱은 서버 성공 후 `daoewo:*` 로컬 학습/설정/기기 cache를 제거하고 sign-out한다.
- `firestore.indexes.json`의 `expiresAt` field override가 delivery/rate-limit 문서 TTL의
  배포 원장이다. receipt tombstone과 target/source deletion marker는 anti-fraud/UID 재사용
  차단 때문에 자동 만료하지 않는다.
