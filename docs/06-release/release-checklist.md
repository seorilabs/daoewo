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
- [ ] Firebase rules/indexes/functions 확정
- [ ] `firestore.indexes.json` 배포 후 delivery/rate-limit `expiresAt` TTL policy `Active` 확인
- [ ] Firebase `.firebaserc`, Android/iOS native config, `TOSS_FIREBASE_APP_ID` 설정
- [ ] `FUNCTIONS_REGION`을 지원 리전 확인 후 release environment에 명시
- [ ] Privacy/data safety/review notes 확정
- [ ] Functions `GOOGLE_PLAY_RTDN_TOPIC=<topic ID>`와 Play Console `projects/<FIREBASE_PROJECT_ID>/topics/<topic ID>`를 분리 설정
- [ ] Play Console RTDN에서 **Get notifications for subscriptions and all voided purchases** 선택
- [ ] `google-play-developer-notifications@system.gserviceaccount.com` topic Publisher IAM, Functions Android Publisher runtime IAM, **Send Test Message** 수신 검증
- [ ] App Store App Apple ID/product allowlist/IAP issuer·key ID와 두 Secret Manager 값 검증
- [ ] Play/StoreKit 서버 영수증 검증과 구매 복원 sandbox 통과
- [ ] 구현된 `googlePlaySubscriptionNotification`·`appStoreServerNotification`을 sandbox에서 환불/취소/갱신 E2E 검증
- [ ] Play sandbox에서 refund-without-revoke(접근 유지), revoke, chargeback의 current state/order 전파 E2E 분리 검증
- [ ] Apple Notification History scheduler/cursor와 Google Voided Purchases API scheduler/cursor/IAM 구현·live 검증
- [ ] claim 전 notification pending marker + direct claim-only/grant-hold 2-phase 구현·race E2E
- [ ] Google missed renewal 자동 복구(client reverify 또는 승인된 KMS token 경계) 구현·검증
- [ ] Google `linkedPurchaseToken` old/new claim을 같은 principal에서 원자 supersede하고 unrelated UID 이중 권한 차단 E2E
- [ ] `functions/store-notification-readiness.json`의 reconciliation/migration/live gate 전부 true
- [ ] AIT official partner mTLS/receipt·webhook provider 연결 및 실결제 검증
- [ ] P1 7덱과 전체 v1 14덱의 출처·라이선스·사람 검수 완료
- [ ] `docs/05-markets/third-party-content-notices.md`의 원문·revision·digest와 앱 내 고지 URL 확정
- [ ] 승인된 실제 콘텐츠로 Play/App Store/AIT screenshot 생성·config 등록

## QA Gate

- [ ] Android smoke
- [ ] iOS smoke
- [ ] Android/iOS cold-start에서 제품 브랜딩 스플래시만 노출됨
- [ ] React Native/프레임워크 기본 런치 화면 문구가 노출되지 않음
- [ ] AppsInToss sandbox smoke
- [ ] Offline/local-first smoke
- [ ] Analytics/crash/ad/purchase smoke, 해당 시
- [ ] Play/App Store account binding, 가격·체험 eligibility, 구매·복원·환불 fail-closed smoke
- [ ] AIT 미지원 Toss App/미설정 partner provider에서 Free-only fail-closed smoke
- [ ] Free 완전 오프라인, Pro 현재 창 24시간 TTL/재연결 smoke
- [ ] `왼쪽=모르겠다`, `오른쪽=안다` 버튼·제스처·접근성 action 일치
- [ ] 작은 화면·다크모드·동적 글자·스크린리더 smoke
- [ ] 사용자 격리/본문 deny/goal churn/quota 우회 emulator 공격 테스트
- [ ] Google/Apple/Toss/익명 계정 탈퇴 E2E, merge source 소거, receipt tombstone 재탈취 차단 확인
- [ ] 탈퇴 서버 성공 뒤 응답 유실/timeout에서도 mobile/AIT 로컬 `daoewo:*` wipe 종결 확인

## Deployment Gate

- [ ] Deployment approval 완료
- [ ] Google Play production 또는 testing track 배포 승인
- [ ] App Store TestFlight 또는 App Review 제출 승인
- [ ] AppsInToss production release 승인

현재 deployment approval은 **미승인**이다. 이 체크리스트가 release-candidate까지 통과해도 제출/프로덕션 공개는 자동으로 허용되지 않는다.

## 현재 Release Inventory (2026-07-12)

- brand assets: Play icon/feature graphic, App Store icon, AIT logo/thumbnail 생성·치수 검증 완료
- store screenshots: Play phone/tablet, App Store iPhone/iPad, AIT vertical 모두 **0장**
- content: Gemini P1 draft 2개(각 20장) `awaiting-human-approval`; published body **0개**
- Firebase: project/native config 미생성, mobile Firebase disabled, AIT backend config 빈 값
- purchase config: mobile product ID/Google client ID/legal URL 빈 값
- receipt: Google/Apple 검증과 실시간 server notification 코드는 있으나 runtime env/secret/IAM/endpoint E2E 미검증
- AppsInToss: `.ait` 후보는 있으나 official partner provider는 unconfigured/fail-closed
- local artifact: Android AAB와 `.ait` 파일은 있으나 이후 source 변경 여부를
  별도 build job에서 확인해야 하며, 최종 source 기준 재빌드 전에는 candidate 완료가 아님

따라서 `pnpm run check:release`가 실패하는 것이 정상이다. 값이나 URL을 임시 문자열로 채워
통과시키지 않는다.
