# Release Checklist

## Planning Gate

- [x] Planning approval 완료(2026-07-12)
- [x] Product spec repo 원장으로 이전
- [x] Package name / bundle ID / AppsInToss appName 코드 반영
- [ ] KIPRIS와 AppsInToss Console 권위 확인
- [ ] Firebase project ID/region/provider 확정·프로비저닝

## Architecture Gate

- [ ] `pnpm run test:core`
- [ ] `pnpm run check:architecture`
- [ ] platform SDK가 core에 import되지 않음
- [ ] Functions와 client가 같은 goal/SRS fixture에서 같은 결과를 생성
- [ ] premium 전체/미래 카드 bulk read가 불가능

## Market Gate

- [ ] Google Play metadata와 config 확정
- [ ] Google Play 외부 계정 삭제 요청 HTTPS URL 게시·Console 등록
- [ ] App Store metadata와 config 확정
- [ ] AppsInToss metadata와 config 확정
- [ ] mobile `googleWebClientId`, 월/연 product ID, terms/privacy URL 설정
- [ ] AIT `apiBaseUrl`, `firebaseApiKey`, terms/privacy URL 설정
- [x] AIT `@apps-in-toss/framework` 2.10.5로 Smart Message client API 최소 2.5.0 충족
- [ ] AIT runtime `requestNotificationAgreement`·설정 adapter와 server Smart Message provider 구현
- [ ] AIT_SMART_MESSAGE_CONSOLE_APPROVED: 요청 덱 기능성 동의문/캠페인과 신규 덱 광고성 분류·수신 동의·`templateSetCode` 문구 검수 승인
- [ ] AIT_SMART_MESSAGE_MTLS_PROVIDER_VERIFIED: `x-toss-user-key` 매핑, partner mTLS 인증서/provider, 멱등성·재시도·빈도 제한 검증
- [ ] AIT_SMART_MESSAGE_E2E_VERIFIED: bundle `deploymentId` test message와 iOS/Android 실제 Toss App 수신·해제·딥링크·중복 방지 검증
- [ ] Firebase rules/indexes/functions 확정
- [ ] `firestore.indexes.json` 배포 후 delivery/rate-limit `expiresAt` TTL policy `Active` 확인
- [ ] Firebase `.firebaserc`, Android/iOS native config, `TOSS_FIREBASE_APP_ID` 설정
- [x] FCM 설치 등록/해제 callable, deck-ready lease outbox, 신규 덱 installation multicast/event lease,
  account merge v2 결과 marker·현재 anonymous provider 재검증·retry cleanup trigger/15분 bounded
  sweeper/index·transaction 내부 late-write 차단·target 탈퇴 source Auth 정리·rules 회귀 구현
- [ ] FIREBASE_OPERATOR_COMPLETION_E2E_VERIFIED: Firebase Auth `operator=true` 운영 계정 발급·회수 절차와 `completeDeckRequest` callable E2E 검증
- [x] mobile opt-in-first FCM adapter, Remote Config kill-switch, Android/iOS 권한·APNs capability 구현
- [x] Android/iOS TTS·local daily/review notification, 계정별 설정, share·JSON export 자동 회귀 구현
- [x] Remote Config template/default parity와 PII-safe Crashlytics adapter 구현
- [ ] Firebase Remote Config template publish와 Crashlytics test event/live console 검증
- [ ] Firebase Functions 배포 후 Android/iOS 실기기 FCM token 등록·회전·로그아웃 해제·신규/요청 덱 수신 E2E
- [ ] `FUNCTIONS_REGION`을 지원 리전 확인 후 release environment에 명시
- [ ] Privacy/data safety/review notes 확정
- [x] App Privacy repo 원장/config/plist에 11개 data type별 Linked/Tracking/Purposes와
  federated 이름·이메일·UID, 대략적 위치, native crash state·FCM 설치 metadata 반영
- [ ] Functions `GOOGLE_PLAY_RTDN_TOPIC=<topic ID>`와 Play Console `projects/<FIREBASE_PROJECT_ID>/topics/<topic ID>`를 분리 설정
- [ ] Play Console RTDN에서 **Get notifications for subscriptions and all voided purchases** 선택
- [ ] `google-play-developer-notifications@system.gserviceaccount.com` topic Publisher IAM, Functions Android Publisher runtime IAM, **Send Test Message** 수신 검증
- [ ] App Store App Apple ID/product allowlist/IAP issuer·key ID와 두 Secret Manager 값 검증
- [ ] Play/StoreKit 서버 영수증 검증과 구매 복원 sandbox 통과
- [ ] 구현된 `googlePlaySubscriptionNotification`·`appStoreServerNotification`을 sandbox에서 환불/취소/갱신 E2E 검증
- [ ] Play sandbox에서 refund-without-revoke(접근 유지), revoke, chargeback의 current state/order 전파 E2E 분리 검증
- [x] Apple Notification History와 Google Voided Purchases API scheduler/cursor·page-token reset 구현·자동 검증
- [ ] Apple/Google scheduler runtime IAM·실행·누락 알림 복구 live 검증
- [x] claim 전 fingerprint pending marker + direct claim-only/grant-hold 2-phase 구현·emulator 회귀 검증
- [ ] Google/Apple sandbox에서 claim 전 notification ↔ direct verification 동시 race E2E
- [x] Google/Apple missed renewal mobile 세션당 client reverify 구현·단위 검증
- [ ] Play/StoreKit sandbox에서 missed renewal 자동 복구 E2E
- [x] Google `linkedPurchaseToken` old/new claim 원자 supersede·old restore/RTDN 차단·merge/삭제 emulator 검증
- [ ] Play sandbox upgrade/downgrade/re-signup에서 linked chain·acknowledge·unrelated UID 공격 E2E
- [ ] `functions/store-notification-readiness.json`의 reconciliation/migration/live gate 전부 true
- [ ] AIT official partner mTLS/receipt·webhook provider 연결 및 실결제 검증
- [x] AIT UID marker 기반 cold-start 재로그인·민감 token 비저장 자동 회귀 검증
- [ ] AppsInToss 실제 Toss App cold-start session 복구 smoke
- [ ] P1 7덱과 전체 v1 14덱의 출처·라이선스·사람 검수 완료
- [ ] `docs/05-markets/third-party-content-notices.md`의 원문·revision·digest와 앱 내 고지 URL 확정
- [ ] 승인된 실제 콘텐츠로 Play/App Store/AIT screenshot 생성·config 등록

## QA Gate

- [ ] Android smoke
- [x] iOS 18.1 Simulator offline smoke: iPhone 16 Pro light + iPhone SE 3세대 dark에서 onboarding/home/catalog/detail/settings 확인
- [ ] iOS Firebase/APNs/StoreKit 실기기 smoke
- [ ] Android/iOS cold-start에서 제품 브랜딩 스플래시만 노출됨
- [ ] React Native/프레임워크 기본 런치 화면 문구가 노출되지 않음
- [ ] AppsInToss sandbox smoke
- [ ] Offline/local-first smoke
- [ ] Analytics/crash/ad/purchase smoke, 해당 시
- [ ] Play/App Store account binding, 가격·체험 eligibility, 구매·복원·환불 fail-closed smoke
- [ ] AIT 미지원 Toss App/미설정 partner provider에서 Free-only fail-closed smoke
- [ ] Free 완전 오프라인, Pro 현재 창 24시간 TTL/재연결 smoke
- [x] Free metadata-only backup·1-device policy와 Pro progress hydrate 자동 회귀 검증
- [ ] 실제 2-device Free 차단·Pro hydrate·offline→online 복구 smoke
- [ ] `왼쪽=모르겠다`, `오른쪽=안다` 버튼·제스처·접근성 action 일치
- [ ] 작은 화면·다크모드·동적 글자·스크린리더 smoke
- [ ] 사용자 격리/본문 deny/goal churn/quota 우회 emulator 공격 테스트
- [ ] Google/Apple/Toss/익명 계정 탈퇴 E2E, merge source Auth cleanup trigger/응답 유실 멱등 복구,
  sweeper backfill/expired lease 회수, stale anonymous token 거부, target 탈퇴 중 pending source 소거,
  receipt tombstone 재탈취 차단 확인
- [ ] 탈퇴 서버 성공 뒤 응답 유실/timeout에서도 mobile/AIT 로컬 `daoewo:*` wipe 종결 확인

## Deployment Gate

- [ ] Deployment approval 완료
- [ ] Google Play production 또는 testing track 배포 승인
- [ ] App Store TestFlight 또는 App Review 제출 승인
- [ ] AppsInToss production release 승인

현재 deployment approval은 **미승인**이다. 이 체크리스트가 release-candidate까지 통과해도 제출/프로덕션 공개는 자동으로 허용되지 않는다.

## 현재 Release Inventory (2026-07-13)

- brand assets: Play icon/feature graphic, App Store icon, AIT logo/thumbnail 생성·치수 검증 완료
- store screenshots: Play phone/tablet, App Store iPhone/iPad, AIT vertical 모두 **0장**
- content: Gemini P1 draft 2개(각 20장) `awaiting-human-approval`; published body **0개**
- content rights: source revision·digest·라이선스 원문·배포 고지·사람 검수 미완료로
  App Store `contentRights=review-required-before-submission`
- Firebase: project/native config 미생성, mobile Firebase disabled, AIT backend config 빈 값
- purchase config: mobile product ID/Google client ID/legal URL 빈 값
- privacy: repo config/manifest는 현재 SDK 수집 범위로 보강했으나 App Store Connect/Play Console
  실제 입력과 최종 binary 대조는 미완료
- receipt: Google/Apple 검증, 실시간 server notification, pre-claim 2-phase barrier,
  linked migration, history reconciliation, missed-renewal client reverify는 구현·자동 검증 완료.
  runtime env/secret/IAM/endpoint 및 sandbox 동시 race/복구 E2E는 미검증
- deck update push: mobile opt-in/권한/token lifecycle, 요청 덱 lease outbox와 신규 덱 opt-in
  installation multicast event lease, foreground 고정 UI, 계정 race·정리 자동 회귀는 구현 완료.
  Firebase project·native FCM config·배포 및 실기기 수신은 미검증
- device features: native TTS, 일일 09시/복습 local 알림, voice guide, 실제 share와 최소화된 JSON
  export는 구현·자동 검증 완료. Android 절전 지연과 실기기 접근성/권한 UX는 미검증
- AppsInToss: `.ait` 후보는 있으나 subscription partner provider와 Smart Message
  `requestNotificationAgreement`/Console template/mTLS provider가 unconfigured/fail-closed
- local artifact: Android AAB와 `.ait` 파일은 있으나 이후 source 변경 여부를
  별도 build job에서 확인해야 하며, 최종 source 기준 재빌드 전에는 candidate 완료가 아님

따라서 `pnpm run check:release`가 실패하는 것이 정상이다. 값이나 URL을 임시 문자열로 채워
통과시키지 않는다.
