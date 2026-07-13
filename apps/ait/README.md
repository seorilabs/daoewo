# 다외워 AppsInToss

AppsInToss용 Granite React Native + TDS 타깃이다. 앱 식별자는 `daoewo`, 진입 scheme은
`intoss://daoewo/`다.

## Runtime 설정

`src/runtime-config.ts`의 다음 공개 값을 Firebase/Functions 배포 후 채운다.

- `apiBaseUrl`: Functions `api`의 공개 HTTPS base URL
- `firebaseApiKey`: AIT용 Firebase Web API key
- `legalUrls.terms` / `privacy`: 결제 화면의 공개 HTTPS 약관 URL

현재 값은 모두 비어 있어 Toss 로그인·App Check bootstrap·서버 콘텐츠·구독·약관 링크가
fail-closed 된다. Free 로컬 기능만 유지하며 임시 endpoint나 가격을 만들지 않는다.

사람 승인 완료 Free 본문·목표·진도는 계정별 AppsInToss Storage에 번들/캐시된다. backend가
구성된 Toss 계정은 시작·로그인·학습 완료 때 본문 없는 Free snapshot을 REST로
pull/merge/push하며, Free primary device 한 대와 Pro 다기기 정책을 서버가 검증한다. Pro
progress는 서버 권위 상태로 hydrate하고 실패 시 로컬 기록을 보존한다. 로그아웃 시 scoped
local state를 지운다.

성공한 Toss 로그인은 로컬 Storage에 UID와 민감정보가 아닌 무작위 작업 세대 marker만 남긴다. cold start에서는 marker가 있을 때
세션당 한 번 `appLogin()`의 새 일회용 authorization code로 backend session을 복구한다. Firebase
ID/refresh/App Check token과 authorization code는 Storage에 저장하지 않는다. 복구 UID가 marker와
다르면 즉시 sign-out하고 marker를 제거하며, 자동 복구 실패 뒤에는 사용자가 명시적으로 다시
로그인할 수 있다.

## 로컬 검증

```bash
pnpm --filter @daoewo/ait lint
pnpm --filter @daoewo/ait typecheck
pnpm --filter @daoewo/ait test --runInBand
pnpm --filter @daoewo/ait build
```

후보 산출물은 `apps/ait/daoewo.ait`다. `.ait` 생성은 콘솔 등록, 이미지 업로드,
Sandbox QA, 정기결제 검증 완료를 뜻하지 않는다.

주간 학습 기록과 최소화된 JSON 내보내기는 AppsInToss 공식 `share()`로 system share sheet를
연다. local daily/review notification과 FCM native module은 이 runtime에서 지원한다고 가정하지
않아 설정을 fail-closed로 비활성화한다. mobile FCM을 AIT의 fallback으로 사용하지 않는다.

현재 `@apps-in-toss/framework` 2.10.5는 `requestNotificationAgreement`의 SDK 2.5.0+ 요구사항을
충족하지만, AIT runtime은 아직 `unsupported` 알림 adapter를 사용한다. 다음 항목이 모두 끝나기
전에는 신규·요청 덱 스마트 메시지를 지원한다고 표시하지 않는다.

- 요청 덱 준비 알림: 알림 동의문과 기능성 캠페인 생성, 문구 검수, `templateSetCode` 승인
- 신규 덱 안내: 기능성으로 간주하지 않고 광고성 분류·수신 동의·캠페인 승인을 별도 확인
- client: `requestNotificationAgreement` 동의/해제와 설정 상태를 연결
- server: `x-toss-user-key` 매핑, partner mTLS 발송 provider, 멱등성·재시도·빈도 제한 연결
- QA: Console bundle `deploymentId`로 test message를 보낸 뒤 iOS/Android 실제 Toss App에서
  수신·해제·딥링크·중복 방지를 검증

Console template, partner mTLS 인증서/provider, 실기기 E2E는 현재 모두 미설정 release
blocker다. 관련 secret과 user key는 client, 문서, 로그에 남기지 않는다.

## 정기결제 게이트

client는 지원 Toss App에서 공식 `IAP` 상품 조회·구매·미결 주문 복구 경로를 사용한다.
하지만 Functions의 AppsInToss receipt/partner provider와 mTLS 로그인 provider는 공식
partner 인증 계약·인증서를 연결하기 전까지 의도적으로 unconfigured다. 따라서 SDK의
`processProductGrant` 성공이나 웹훅 JSON 본문만으로 Pro 권한을 부여하지 않는다.

- 공식 구독 SDK: React Native SDK 1.12.0+, Toss App iOS 5.250.0 / Android 5.253.0
- Sandbox App은 현재 구독 기능 테스트 미지원
- 구독 상품·웹훅 callback·pending order 복구·실결제 E2E와 서버 검증 provider가 release blocker

공식 문서:

- https://developers-apps-in-toss.toss.im/bedrock/reference/framework/%EC%9D%B8%EC%95%B1%20%EA%B2%B0%EC%A0%9C/subscription.html
- https://developers-apps-in-toss.toss.im/bedrock/reference/framework/%EC%9D%B8%EC%95%B1%20%EA%B2%B0%EC%A0%9C/IAP.html
- https://developers-apps-in-toss.toss.im/smart-message/develop.html
- https://developers-apps-in-toss.toss.im/smart-message/qa.html
