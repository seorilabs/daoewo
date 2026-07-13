# 다외워 Firebase

Firebase Auth + App Check를 통과한 `functions/` API가 권위 데이터에 접근한다.
클라이언트는 published 덱 메타와 자기 권한만 직접 읽을 수 있다. 목표/진도 pull과
모든 쓰기는 primary-device 정책을 적용하는 Functions를 통과한다.

## 데이터 경계

- `decks/{deckId}`: 카드 본문이 없는 published catalog metadata
- `users/{uid}/goals/{deckId}`: 날짜별 card index 배정과 24시간 reset cooldown
- `users/{uid}/deckProgress/{deckId}`: 카드별 SRS를 합친 압축 progress 문서
- `users/{uid}/entitlements/pro`: 서버 검증 구독 권한
- `users/{uid}/sync/devicePolicy`: Free primary device hash, Pro는 접근 제한 미적용
- `users/{uid}/sync/learningBackup`: 본문·UID·device 식별자 없는 Free 목표/progress·세션 요약
- `deliveryLogs`, `deliveryCounters`: 오늘 창/고유 premium 카드 soft-cap 감사 로그
- `deckRequests`: Functions가 rate limit과 Pro 우선순위를 판정해 `queued`로 생성하고,
  서버 작업자가 `readyDeckId`, 단조 증가 `readyRevision`, `readyAt`과 함께 `ready`로 전환
- `notificationInstallations`: Auth + App Check + 폐기 확인 callable만 쓰는 mobile FCM 설치 정보
- `notificationOutbox`: `queued → ready` 전환마다 revision 기반 결정적 ID로 한 번 생성하는 전달 작업
- `receiptClaims`, `subscriptionEvents`: 검증된 store purchase binding/webhook replay 방지
- `receiptAuthorityBarriers/{receiptFingerprint}`: claim 전 알림이 direct Pro grant를 보류시키는
  fingerprint-keyed 영구 pending marker(Admin/Functions 전용)
- `storeReconciliationCursors/{source}`: Google/Apple history 고정 window와 page token만 저장
- `tossAuthCodeClaims`: `appLogin()` authorizationCode 일회성 소비 기록
- `tossAuthExchangeCounters`: App Check bootstrap 전 교환 route의 IP 해시 rate limit
- `tossAppCheckRefreshCounters`: AIT ID token 기반 App Check 재발급 user/IP rate limit
- `accountMerges/{sourceUid}`: 병합 결과와 post-commit cleanup 상태/5분 lease를 가진 v2 source
  재사용 차단 marker. 생성 trigger와 15분 bounded reconciliation이 source Auth 폐기와 target
  claim 투영을 멱등 재시도
- `accountDeletions/{uid}`: 탈퇴 시작 전에 생성해 동시 쓰기를 차단하는 삭제 marker
- Storage `decks/{deckId}/v{version}/chunk-{i}.json`: 불변 원본, Admin SDK 전용

기본 chunk size는 200이다. Functions 웜 인스턴스는 `(deckId, version, chunk)`를
키로 메모리 캐시하며, premium 응답에는 현재 목표의 오늘 배정분과 도래 복습만
포함한다. 미래 배정/전체 export endpoint는 없다.

## Emulator

```bash
cd functions
npm install
npm run test:all
```

실제 project ID는 확정 후 `.firebaserc.example`을 복사한 로컬 `.firebaserc` 또는
배포 명령의 `--project`로 지정한다. service account JSON/private key는 커밋하거나
클라이언트에 포함하지 않는다.

AppsInToss 로그인 code 교환과 `subscription.status_changed` 검증은 mTLS partner
provider 구현이 서버에 주입된 뒤에만 열린다. Toss Access/Refresh token과 mTLS key는
Functions provider 밖이나 클라이언트 응답에 포함하지 않는다. AppsInToss sandbox는
자동갱신 구독 테스트를 지원하지 않으므로 실제 provider E2E는 콘솔 등록 후 prod-like
검증을 별도 release gate로 수행한다.

AIT 로그인 교환 route는 native App Check 부재로 선행 App Check를 요구하지 않는다.
대신 code 일회성 소비, IP 해시 rate limit, Toss mTLS 검증을 모두 통과한 뒤
`TOSS_FIREBASE_APP_ID`용 custom App Check token을 Firebase custom auth token과 함께
발급한다. 이 appId가 없으면 로그인 교환도 닫힌다.
동일 Toss subject의 UID에 탈퇴 marker가 남아 있으면 custom token 발급 전에 차단하며,
현재 정책은 탈퇴 후 동일 UID 재가입을 허용하지 않는다.

AIT App Check 갱신 route는 App Check 선행 요구 없이, 폐기 여부까지 확인한 Firebase
ID token과 `signInProvider=apps-in-toss` custom claim, `toss_*` uid를 모두 검증한다.
App Check token/TTL 외에는 다시 발급하지 않으며 Firebase ID token까지 만료되면
`appLogin()` 재로그인이 필요하다.

## 계정 삭제와 TTL

`deleteAccount` callable과 `api /v1/account:delete`는 Auth, App Check,
`confirmation=DELETE`를 모두 요구한다. Google/Apple/Toss 계정은 5분 이내 재인증을
추가로 요구한다. 재인증 credential이 없는 익명 계정만 폐기 여부까지 확인한 유효 ID token과
App Check를 소유 증명으로 인정한다. 서버는 삭제 marker를 먼저 만든 뒤 현재 UID와
그 계정으로 병합된 source UID의 `users` 하위 문서, 요청, 전달 로그, user counter,
subscription event를 멱등 삭제하고 마지막에 Firebase Auth user를 삭제한다. marker를
읽는 쓰기 transaction은 삭제 시작과 동시에 실패한다.

target 탈퇴가 merge cleanup보다 먼저 시작되면 서버는 각 source Auth 폐기를 먼저 성공시킨
뒤에만 `accountMerges`를 최소 source deletion tombstone으로 전환한다. Auth cleanup 실패 시 merge
marker를 유지해 재시도 근거가 사라지지 않는다. rules의 `activeOwner`도 merge/deletion marker가
생긴 즉시 source token의 직접 user/entitlement/request read를 차단한다.
Functions의 계정 소유 write transaction도 두 marker를 같은 transaction 안에서 읽어 병합과
동시 실행된 늦은 source write를 재시도 시점에 거부한다. 신규 병합은 signed token claim뿐 아니라
Admin Auth의 현재 provider 목록이 비어 있는지도 확인한다.

cleanup reconciliation은 `schemaVersion=2`, 상태 `pending/failed/claimed`,
`cleanupUpdatedAt <= now-5m`을 oldest-first 최대 50개 조회한다. 이 고정 5분 cutoff는 expired
claimed lease를 포함하고 active lease는 제외한다. query composite index는
`schemaVersion + cleanupStatus + cleanupUpdatedAt`이며 scheduler는 15분, max instance/concurrency
각 1로 동작한다. 로그에는 UID나 provider 원본 오류를 남기지 않고 처리 건수만 기록한다.

`receiptClaims`는 구매 탈취와 환불/복원 재바인딩을 막기 위해 지우지 않는다. 대신 raw
UID·platform·product·original transaction·merge source를 제거하고
`ownershipState=account-deleted`, `bindingRetained=true`인 fingerprint tombstone으로
남긴다. 새 계정은 이 fingerprint를 자동으로 가져갈 수 없다.

Google/Apple 알림이 receipt claim보다 먼저 오면 claim 조회와 같은 Firestore transaction에서
`receiptAuthorityBarriers`를 생성하고 transport를 retry한다. marker payload는 `state`,
`platform`, 관측 시각/횟수뿐이며 raw store ID/token/JWS/UID/product/event를 넣지 않는다.
direct receipt 검증 transaction은 marker가 있으면 claim을 생성할 수 있지만 entitlement는
Free로 보류한다. claim을 찾은 notification retry가 store API 현재 상태, idempotency event,
entitlement projection, marker 삭제를 한 transaction으로 commit한 뒤에만 Pro가 열릴 수 있다.
marker는 TTL 대상이 아니며 account merge에서는 유지되고 account deletion receipt tombstone
전환에서는 같은 transaction으로 제거된다.

Google `linkedPurchaseToken`은 Functions가 API 응답을 받은 즉시 old hashed original
ID/fingerprint pair로 바꾼다. direct verification transaction은 old/new claim, entitlement,
두 pre-claim barrier를 함께 읽어 동일 UID 또는 검증된 merge target인지 확인한다. old claim은
raw token 없이 `ownershipState=superseded`, hashed `supersededBy`만 가진 tombstone으로 바꾸고
new claim의 hashed `predecessor`와 entitlement를 같은 commit에 쓴다. old restore는 거부하고
old RTDN은 store query 없이 ACK한다. new RTDN의 API linked hash가 claim predecessor와 다르면
fail-closed한다. 탈퇴 시 두 chain 필드와 UID는 모두 제거한다.

Google Voided Purchases와 Apple Notification History scheduler는 기존 receipt claim이 있는
구독만 현재 store API 권위 경로로 다시 처리한다. cursor에는 window/page token만 남고 raw
purchase token, order/transaction ID, Apple JWS는 저장하지 않는다. vendor page token이
만료되면 같은 window의 첫 페이지로 원자 reset하며 이미 반영한 event는 idempotency 문서로
중복 적용하지 않는다.

덱 준비 알림 outbox에는 `requestId`, `requestRevision`, 상태, 시각, 집계값만 저장한다.
UID, FCM token, topic, note는 넣지 않고 처리 시점에 권위 `deckRequests`와 현재 설치 정보를
다시 읽는다. 계정 병합은 요청과 `lastSeenAt` 최신순 계정 합산 10개 설치 소유권을 target UID로
함께 옮기며, 계정 삭제는 현재 계정과 병합 source의 설치를 제거한다. 클라이언트의 두 컬렉션
직접 접근은 rules로 차단한다.
FCM device payload는 고정 제목/본문과 `kind=deck-ready` 또는 `kind=catalog-published`만
포함하고 request/deck ID를 보내지 않으며, collapse/tag에는 결정적 opaque event hash만 사용한다.

`firebase/firestore.indexes.json`이 `expiresAt` TTL policy의 원장이다. delivery log/counter,
deck request counter, Toss auth/App Check rate-limit, 마지막 등록 후 35일이 지난 notification
installation, 완료 후 30일이 지난 notification outbox와 catalog event ledger 문서는 TTL
대상이다. account deletion marker와 receipt tombstone은 UID/구매 resurrection 차단에 필요한
보안 기록으로 영구
보존한다. 병합 source는 target 탈퇴 시 `accountMerges/{sourceUid}` 삭제와 최소
`accountDeletions/{sourceUid}` 생성이 같은 atomic batch로 전환된다. source tombstone은
문서 ID와 `status/reason/createdAt`만 남기며 target UID 연결 정보는 보존하지 않는다.
프로젝트와 deployment approval이 확정된 뒤 아래 명령으로 index와 TTL을 함께 배포하고
Firestore Console의 TTL policy 상태가 `Active`인지 별도로 확인한다.

```bash
pnpm --dir functions exec firebase deploy \
  --config ../firebase/firebase.json \
  --only firestore:indexes \
  --project <firebase-project-id>
```
