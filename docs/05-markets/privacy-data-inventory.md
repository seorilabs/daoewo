# 개인정보·데이터 수집 원장

이 문서는 코드/SDK 변경 시 Google Play Data safety, App Store privacy labels, AppsInToss 심사 답변을 함께 갱신하기 위한 원장이다. 콘솔 실제 입력 전에는 완료로 보지 않는다.

## 데이터

| 데이터 | 목적 | 저장/전송 | 삭제 |
| --- | --- | --- | --- |
| 익명/연결 계정 UID, 이름, 이메일, 로그인 provider | 계정·화면 표시·복구·구독 연결 | Firebase Auth | 회원탈퇴 시 삭제/익명화 |
| 목표, 카드별 압축 progress, 학습 세션 요약, 오답 큐, 스트릭 | 앱 기능·동기화 | Firestore + 기기 cache | 설정의 계정 삭제/내보내기 |
| 구매 영수증 식별자와 entitlement | 구독 검증·복원·재바인딩 방지 | Functions/Firestore | 탈퇴 시 UID/entitlement 삭제, fingerprint는 비식별 anti-fraud tombstone으로 보존 |
| 덱 요청 topic/category/locale/note | 콘텐츠 수요 처리 | Firestore | 요청 삭제/계정 삭제 정책 적용 |
| Analytics event와 기기/앱 식별자 | 제품 개선·전환 분석 | Firebase Analytics | Firebase 보존 정책/사용자 삭제 요청 |
| Crash stack·관련 app state·기기/OS와 allowlist operation/surface/error code/platform/build | 안정성 | Crashlytics | Firebase 보존 정책 |
| FCM token, 설치 hash/ID, 기기 model·OS·timezone·language, platform, 앱 ID/version/build, locale, 알림 설정 | 신규·요청 덱 푸시 opt-in·계정별 설치 multicast·invalid token 정리 | Firebase | opt-out/로그아웃/탈퇴 시 client token 무효화와 설치 삭제 시도, 마지막 등록 후 35일 TTL |
| IP 기반 대략적 위치 | Google federated 로그인 fraud prevention | Google Sign-In | Google provider 보존 정책 |
| App Check attestation | API 남용 방지 | Firebase | provider 보존 정책 |

민감한 건강·금융 데이터, 정밀 위치, 주소록, 광고 ID, 사용자 생성 공개 콘텐츠는 수집하지
않는다. 단, Google Sign-In은 fraud prevention을 위해 IP에서 대략적 위치를 추정할 수 있다.
카드 학습 결과는 교육 활동 데이터로 취급해 최소화한다.

네이티브 앱은 Firebase Analytics 광고 식별자 연동을 사용하지 않는다. iOS는
`$RNFirebaseAnalyticsWithoutAdIdSupport = true`, Android는 광고 ID 수집과 광고 개인화
신호를 manifest에서 비활성화한다. App Store privacy manifest에는 사용자 ID·이름·이메일,
대략적 위치, 구매 기록, 학습/요청 콘텐츠, 제품 상호작용, native Crash·기타 진단·기기
식별자의 실제 목적과 연결 여부를 선언한다. raw JS Error 자동 변환을 꺼도 Crashlytics native
SDK가 수집하는 crash stack·관련 app state·기기/OS 정보는 별도 disclosure 대상이다.
최종 App Store Connect/Play Console 답변은 제출 직전 바이너리와 다시 대조한다.

### App Store PrivacyInfo 계약

`app-store/app-store.config.json`의 `privacy.dataTypes`가 machine-readable 원장이다. release
checker는 `PrivacyInfo.xcprivacy`를 plist 구조로 parse하고 아래 각 type의 Linked, Tracking,
Purposes를 exact match한다. 새 SDK 데이터가 생기면 config, plist, 이 표를 함께 바꾼다.

| Apple data type | Linked | Tracking | Purposes | 근거 |
| --- | --- | --- | --- | --- |
| `UserID` | true | false | App Functionality | Firebase 계정·구독·학습 연결 |
| `Name` | true | false | App Functionality | federated 계정 표시 |
| `EmailAddress` | true | false | App Functionality | federated 계정·복구 |
| `CoarseLocation` | true | false | App Functionality | Google Sign-In IP 기반 fraud prevention |
| `PurchaseHistory` | true | false | App Functionality | entitlement 검증·복원 |
| `OtherUserContent` | true | false | App Functionality | 학습 progress·덱 요청 |
| `ProductInteraction` | false | false | Analytics | allowlist 제품 이벤트 |
| `CrashData` | false | false | Analytics | Crashlytics native crash |
| `OtherDiagnosticData` | false | false | App Functionality, Analytics | app state·기기/OS·고정 진단 context |
| `OtherDataTypes` | true | false | App Functionality, Analytics | FCM installation의 platform·locale·appVersion·buildNumber를 UID 문서에 저장 |
| `DeviceID` | true | false | App Functionality, Analytics | FCM installation/token 식별과 Firebase 기기 식별자 |

현재 이용약관·개인정보처리방침의 공개 HTTPS URL은 mobile/AIT runtime과 Play/App Store
config 모두 미설정이다. 정책 원문이 repo에 있어도 공개 URL과 결제 CTA 연결 전에는
privacy/review gate 완료로 보지 않는다.

회원탈퇴는 서버가 현재 계정과 병합 source UID의 학습/요청/전달/구독 이벤트를 지운 뒤
Firebase Auth를 마지막에 삭제한다. 결제 fingerprint tombstone과 삭제 marker는 다른
계정의 구매 탈취 및 삭제 UID 부활을 막는 보안 기록이라 사용자 식별 필드를 제거한 상태로
보존한다. receipt tombstone에서는 raw transaction/product/platform/merge UID도 제거한다.
Google subscription 교체 중에는 raw old/new token을 저장하지 않고 각각의 hash pair와 현재
UID만 `superseded` chain tombstone에 보존한다. 회원탈퇴 시 predecessor/successor chain과 UID도
제거해 일반 account-deleted fingerprint tombstone으로 축약한다.
병합 source blocker는 target 연결 없는 최소 deletion tombstone으로 영구 보존한다. 이는
폐기 실패한 Auth/refresh token까지 포함한 UID resurrection 방지 목적의 보존 예외다. 단기
delivery/rate-limit 기록은 repo-local Firestore TTL policy로 만료한다.

덱 준비 notification outbox에는 결정적 event hash, request ID/revision, 처리 상태와 성공/무효/영구
실패 집계만 저장하고 완료 후 30일 TTL을 적용한다. UID, raw FCM token, 자유 입력 topic/note는
outbox·로그·응답에 저장하거나 전송하지 않는다. 실제 FCM payload는 고정 제목/본문과
`kind=deck-ready` 또는 `kind=catalog-published`만 담고, collapse/tag에는 결정적 opaque event
hash만 사용한다. request/deck ID도 device payload에 보내지 않는다. 신규 덱도 공개 topic이 아닌
현재 opt-in installation multicast를 사용하며 자유 입력이나 덱 메타를 담지 않는다.

AppsInToss Smart Message는 현재 adapter/provider가 미설정이므로 `x-toss-user-key`, test용
`x-anon-key`, `templateSetCode`, 알림 동의 결과를 수집·저장·전송하지 않는다. 향후 연결 시에는
AIT partner server 경계와 보존·삭제 정책을 이 원장에 먼저 추가하고, 해당 식별자를 Firebase
FCM installation/outbox에 섞거나 client·Crashlytics·일반 로그에 기록하지 않는다.

Free cloud backup에는 덱/version, 활성 목표, card index/ID별 압축 progress와 세션 수치만
포함한다. 카드 앞·뒷면/힌트/예시, UID, device ID/hash는 snapshot에 저장하지 않으며 Free
본문은 검증된 앱 bundle에서만 다시 결합한다. 스토어 reconciliation cursor에는 조회 window와
vendor page token만 저장하고 purchase token·order/transaction ID·Apple JWS는 저장하지 않는다.
AppsInToss Storage에는 cold-start 복구용 Firebase UID marker만 남긴다. Toss authorization code와
Firebase ID/refresh/App Check token은 메모리에만 두고 로그아웃·탈퇴 시 marker도 제거한다.

설정의 JSON 내보내기는 목표·압축 progress·세션 수치만 공유 sheet로 전달한다. 카드 앞/뒤,
힌트·예시, 계정 UID, device ID/hash, 영수증·token은 내보내지 않는다.

## Analytics 이벤트

모든 이벤트 prefix는 `memo`이며 자유 입력 topic/note, 이메일, UID를 파라미터로 보내지 않는다.

| 이벤트 | 허용 파라미터 |
| --- | --- |
| `memo_deck_open` | `deck_id`, `tier`, `source` |
| `memo_goal_set` | `mode`, `days`, `daily_count` |
| `memo_session_start` | `deck_id`, `target_count` |
| `memo_session_complete` | `known`, `unknown`, `elapsed_ms` |
| `memo_review_outcome` | `outcome` |
| `memo_catalog_browse` | `category` |
| `memo_premium_deck_tap` | `deck_id` |
| `memo_deck_request` | `category`, `locale` |
| `memo_paywall_view` | `trigger` |
| `memo_subscribe` | `plan`, `trial` |
| `memo_streak_extend` | `streak_days` |
| `memo_share` | `type` |

## 연령/아동 경계

v1은 중·고등 및 성인용(13세 이상)으로 계획한다. 초등(K-6)은 가족정책/COPPA/GDPR-K 및 보호자·결제·데이터 흐름을 별도 승인한 phase 2 전까지 공급하지 않는다. 실제 연령등급은 앱 콘텐츠와 SDK를 기준으로 각 콘솔에서 사람이 입력해야 한다.

## 현재 제출 상태

- Google Play Data safety: 콘솔 미입력
- App Store privacy labels: 콘솔 미입력
- AppsInToss 개인정보/결제 심사 답변: 콘솔 미입력
- 실제 store screenshot: Play/App Store/AppsInToss 모두 0장

콘솔 입력과 실제 바이너리·runtime config 대조 전에는 위 항목을 완료 처리하지 않는다.
