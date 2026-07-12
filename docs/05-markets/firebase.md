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
| Remote Config | 예 | 한도/TTL/기능 flag, 보안 권위로 사용 금지 |
| Analytics | 예 | `memo_*` funnel |
| Crashlytics | 예 | mobile native, AIT 대체 로깅 검토 |
| Performance | 초기 제외 | 병목 근거가 생기면 추가 |
| FCM | 예 | mobile 알림, AIT 스마트발송 별도 adapter |
| App Check | 예 | mobile provider와 AIT 호환 경로를 각각 검증 |

## Rules

- Firestore rules: `firebase/firestore.rules`
- Firestore indexes: `firebase/firestore.indexes.json`
- Storage rules: `firebase/storage.rules`

## Security

- service account JSON과 private key는 client app에 포함하지 않는다.
- Firebase API key와 app ID는 식별자지만, release docs와 CI secret ownership은 분리해서 관리한다.
- 공유 Firebase project를 쓰면 `app_id`, path prefix, tenant field, custom claims 등으로 앱 경계를 명확히 한다.

## Runtime / Secret Inventory

Firebase 프로젝트 확정 후 repo 공개 config와 Functions 런타임을 함께 맞춘다. secret 값은
출력·문서화·커밋하지 않고 Secret Manager 또는 runtime identity에만 둔다.

| 경계 | 필요한 값 | 현재 |
| --- | --- | --- |
| mobile | Firebase native config, `googleWebClientId`, 월/연 product ID, legal URLs | 미설정 |
| AIT | `apiBaseUrl`, `firebaseApiKey`, `TOSS_FIREBASE_APP_ID`, legal URLs | 미설정 |
| Functions deployment | `FUNCTIONS_REGION` 명시값 | 리전 확정 전. local fallback `asia-northeast3`만으로 release deploy 금지 |
| Google Play receipt/RTDN | product allowlist, Functions topic ID, Play Console full topic resource, Publisher IAM, Android Publisher runtime IAM | RTDN/voided 코드 구현, 값/IAM/Test Message 미검증 |
| App Store receipt env | `APP_STORE_APP_APPLE_ID`, `APP_STORE_PRODUCT_IDS`, `APP_STORE_IAP_ISSUER_ID`, `APP_STORE_IAP_KEY_ID` | 미설정 |
| App Store receipt secret | `APP_STORE_IAP_PRIVATE_KEY_BASE64`, `APP_STORE_ROOT_CA_CERTIFICATES_BASE64_JSON` | Secret Manager 미검증 |
| App Store V2 callback | `appStoreServerNotification` HTTPS URL을 production/sandbox Server Notifications V2 URL로 등록 | 코드 구현, URL/E2E 미검증 |
| AppsInToss partner | mTLS identity/receipt·webhook 검증 provider | unconfigured, fail-closed |

`pnpm run check:release`는 값 자체를 출력하지 않고 주입 여부와 Functions secret wiring만
검사한다. 실제 Secret Manager version, runtime service account IAM, provider 인증서는 Firebase
프로젝트가 생긴 뒤 원격 상태로 다시 검증한다.

Google RTDN과 App Store V2 callback은 claim UID를 찾은 뒤 store API 현재 상태를 재조회한다.
event cursor가 아니라 API query start/response window가 권위 ordering이며 overlap은 inactive가
이긴다. claim 전 알림은 retry하고 삭제 tombstone만 ACK하지만, persistent pending barrier와
direct claim-only/grant-hold가 없어 첫 retry 전 transient grant race는 release blocker다.
Google voided subscription도 처리하며 raw purchase/linked token과 Apple JWS는 비저장·비로그다.

남은 release blocker는 Apple Notification History scheduler/cursor, Google Voided Purchases
API scheduler/cursor/IAM, missed renewal recovery, pre-claim pending barrier, Google linked
purchase atomic migration이다. Voided Purchases token은
처리 중 즉시 fingerprint로 변환하고 저장하지 않는다. repo 원장은
`functions/store-notification-readiness.json`이며 live IAM/endpoint 검증까지 false인 동안
`check:release`가 실패한다. Google topic Publisher/Test Message와 Functions runtime의
Android Publisher API IAM, Apple outer callback과 status API/nested JWS E2E는 별도 gate다.

## 데이터 경계

- `decks`: 잠금 포함 카탈로그 메타 읽기 가능
- `deckContent` 및 Storage의 Pro 청크: client 직접 read deny, Admin/Functions 전용
- `users/{uid}/goals`, `deckProgress`, `entitlements`: 본인 read, 권위 필드는 Functions만 write
- `deckRequests`: 본인 create/read, 운영 상태는 Functions/Admin만 변경
- Free backup은 서버에 기록된 `primaryDeviceId` 한 대만 허용, Pro는 다기기 허용

## 계정 삭제

- `deleteAccount` / `POST /v1/account:delete`: Auth + App Check + `DELETE` 확인값을 요구한다.
  Google/Apple/Toss는 5분 이내 재인증, 익명 계정은 폐기 여부를 확인한 유효 ID token을
  소유 증명으로 사용한다. 익명 탈퇴를 위해 새 UID를 만들지 않는다.
- 삭제 순서: `accountDeletions/{uid}` marker → 현재/병합 source UID 권위 데이터 정리 →
  receipt claim 비식별 tombstone → Firebase Auth user 삭제(마지막).
- 병합 source blocker는 target 탈퇴 시 atomic batch로 영구 최소 deletion tombstone으로
  전환한다. target 연결 값은 source tombstone에 남기지 않는다. 이 보존 예외는 폐기 실패한
  Auth/refresh token을 포함한 UID resurrection 차단 목적이다.
- 앱은 서버 성공 후 `daoewo:*` 로컬 학습/설정/기기 cache를 제거하고 sign-out한다.
- `firestore.indexes.json`의 `expiresAt` field override가 delivery/rate-limit 문서 TTL의
  배포 원장이다. receipt tombstone과 target/source deletion marker는 anti-fraud/UID 재사용
  차단 때문에 자동 만료하지 않는다.
