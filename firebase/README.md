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
- `deliveryLogs`, `deliveryCounters`: 오늘 창/고유 premium 카드 soft-cap 감사 로그
- `deckRequests`: Functions가 rate limit과 Pro 우선순위를 판정해 생성
- `receiptClaims`, `subscriptionEvents`: 검증된 store purchase binding/webhook replay 방지
- `tossAuthCodeClaims`: `appLogin()` authorizationCode 일회성 소비 기록
- `tossAuthExchangeCounters`: App Check bootstrap 전 교환 route의 IP 해시 rate limit
- `tossAppCheckRefreshCounters`: AIT ID token 기반 App Check 재발급 user/IP rate limit
- `accountMerges/{sourceUid}`: 병합된 source 계정의 재사용 차단 marker
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

`receiptClaims`는 구매 탈취와 환불/복원 재바인딩을 막기 위해 지우지 않는다. 대신 raw
UID·platform·product·original transaction·merge source를 제거하고
`ownershipState=account-deleted`, `bindingRetained=true`인 fingerprint tombstone으로
남긴다. 새 계정은 이 fingerprint를 자동으로 가져갈 수 없다.

`firebase/firestore.indexes.json`이 `expiresAt` TTL policy의 원장이다. delivery log/counter,
deck request counter, Toss auth/App Check rate-limit 문서는 TTL 대상이다. account deletion
marker와 receipt tombstone은 UID/구매 resurrection 차단에 필요한 보안 기록으로 영구
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
