# 개인정보·데이터 수집 원장

이 문서는 코드/SDK 변경 시 Google Play Data safety, App Store privacy labels, AppsInToss 심사 답변을 함께 갱신하기 위한 원장이다. 콘솔 실제 입력 전에는 완료로 보지 않는다.

## 데이터

| 데이터 | 목적 | 저장/전송 | 삭제 |
| --- | --- | --- | --- |
| 익명/연결 계정 UID, 로그인 provider | 계정·복구·구독 연결 | Firebase Auth | 회원탈퇴 시 삭제/익명화 |
| 목표, 카드별 압축 progress, 오답 큐, 스트릭 | 앱 기능·동기화 | Firestore + 기기 cache | 설정의 계정 삭제/내보내기 |
| 구매 영수증 식별자와 entitlement | 구독 검증·복원·재바인딩 방지 | Functions/Firestore | 탈퇴 시 UID/entitlement 삭제, fingerprint는 비식별 anti-fraud tombstone으로 보존 |
| 덱 요청 topic/category/locale/note | 콘텐츠 수요 처리 | Firestore | 요청 삭제/계정 삭제 정책 적용 |
| Analytics event와 기기/앱 식별자 | 제품 개선·전환 분석 | Firebase Analytics | Firebase 보존 정책/사용자 삭제 요청 |
| Crash 진단 정보 | 안정성 | Crashlytics | Firebase 보존 정책 |
| FCM token, 알림 설정 | 학습·복습·덱 준비 알림 | Firebase | opt-out/로그아웃/탈퇴 시 삭제 |
| App Check attestation | API 남용 방지 | Firebase | provider 보존 정책 |

민감한 건강·금융·위치·연락처 데이터, 광고 ID, 사용자 생성 공개 콘텐츠는 수집하지 않는다. 카드 학습 결과는 교육 활동 데이터로 취급해 최소화한다.

네이티브 앱은 Firebase Analytics 광고 식별자 연동을 사용하지 않는다. iOS는
`$RNFirebaseAnalyticsWithoutAdIdSupport = true`, Android는 광고 ID 수집과 광고 개인화
신호를 manifest에서 비활성화한다. App Store privacy manifest에는 사용자 ID·이메일·구매
기록·학습/요청 콘텐츠·제품 상호작용·Crash·기기 식별자의 실제 목적과 연결 여부를 선언한다.
최종 App Store Connect/Play Console 답변은 제출 직전 바이너리와 다시 대조한다.

현재 이용약관·개인정보처리방침의 공개 HTTPS URL은 mobile/AIT runtime과 Play/App Store
config 모두 미설정이다. 정책 원문이 repo에 있어도 공개 URL과 결제 CTA 연결 전에는
privacy/review gate 완료로 보지 않는다.

회원탈퇴는 서버가 현재 계정과 병합 source UID의 학습/요청/전달/구독 이벤트를 지운 뒤
Firebase Auth를 마지막에 삭제한다. 결제 fingerprint tombstone과 삭제 marker는 다른
계정의 구매 탈취 및 삭제 UID 부활을 막는 보안 기록이라 사용자 식별 필드를 제거한 상태로
보존한다. receipt tombstone에서는 raw transaction/product/platform/merge UID도 제거한다.
병합 source blocker는 target 연결 없는 최소 deletion tombstone으로 영구 보존한다. 이는
폐기 실패한 Auth/refresh token까지 포함한 UID resurrection 방지 목적의 보존 예외다. 단기
delivery/rate-limit 기록은 repo-local Firestore TTL policy로 만료한다.

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
