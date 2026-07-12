# App Store

## App Identity

- Bundle ID: `com.seorilabs.daoewo`
- SKU: `daoewo-ios`
- App name KO: `다외워`
- App name EN: `Daoewo`
- Subtitle: 무엇이든 외우는 스와이프 암기
- Category: Education
- Support URL: `확정 필요`
- Marketing URL: 선택 항목이므로 v1에서는 빈 값으로 생략

## App Information

- Privacy policy URL: 공개 URL 배포 필요
- App Privacy 원장: federated 계정 이름·이메일·UID, Google Sign-In IP 기반 대략적 위치,
  구매·학습/요청, FCM 식별자, native crash state·기기/OS·기타 진단을 실제 SDK 기준으로 선언
- `app-store.config.json`의 11개 Apple data type별 Linked/Tracking/Purposes 계약과
  `PrivacyInfo.xcprivacy`를 구조 parse해 exact match한다. 문자열 존재만으로 통과시키지 않는다.
- Age rating answers: 실제 콘텐츠/SDK 기준 App Store Connect 입력 필요
- Export compliance: 표준 HTTPS 외 별도 암호화 사용 여부 확인 필요
- Review notes: 게스트 시작 경로, Free/Pro 잠금, 7일 체험, 구매 복원 경로를 설명
- Demo account: 게스트 경로 우선, Pro 심사용 sandbox 계정 필요 시 별도 제공

## Assets

- App icon: `app-store/assets/icon-1024.png` (1024x1024 RGB PNG 생성·치수 검증 완료)
- Xcode AppIcon: iPhone, iPad 152x152/167x167, marketing slot 생성 완료
- Native launch screen: 인디고 배경 + `다외워` + 태그라인 구현, `ibtool` 검증
- iPhone screenshots: config 기준 **0장**, 승인된 실제 콘텐츠 기반 5장 필요
- iPad screenshots: config 기준 **0장**. 현재 native target이 iPad를 지원하므로 13-inch
  실화면을 준비하거나 지원 범위를 명시적으로 바꿔야 한다.

## Release

- Signing team: org variable `APPLE_TEAM_ID`
- Provisioning profile: repo/app-store environment secret 필요
- TestFlight group: `확정 필요`
- Release notes: release tag 시 생성

## 구독/로그인

- 자동갱신 월/연 구독과 7일 introductory offer를 App Store Connect에서 생성해야 한다.
- `app-store.config.json`과 mobile runtime의 월/연 product ID는 현재 미확정/빈 값이다.
- `app-store.config.json`, `play-store/google-play.config.json`, mobile runtime과 Functions
  allowlist의 월/연 product ID는 release checker에서 같은 값인지 대조한다.
- Google 등 제3자 로그인을 제공하므로 iOS에서 Sign in with Apple 경로를 함께 검증한다.
- 구매 복원과 계정 삭제는 설정 화면에서 접근 가능해야 한다.
- client는 Firebase UID 기반 UUID `appAccountToken`을 구매에 전달한다. Functions는 Apple
  JWS와 App Store Server API 응답을 검증한 뒤에만 entitlement를 기록한다.
- 같은 original transaction의 allowlisted 월/연 product 전환은 최신 signed transaction으로
  claim을 원자 갱신한다. 지연된 old-product notification도 current product 상태를 적용한다.
- retryable App Store API error(`4040002/4040004/4040006` 포함)는 503 경로로 유지한다.
- production 179일/sandbox 29일 window를 6시간 overlap으로 조회하는 Notification History
  scheduler를 각각 15분마다 실행한다. `onlyFailures=true` history의 JWS를 메모리에서 검증한
  뒤 기존 claim만 현재 `Get All Subscription Statuses`로 재조회하며 payload는 저장하지 않는다.
  만료된 pagination token은 같은 고정 window 첫 페이지로 원자 reset한다.

Functions 배포 환경에 필요한 값:

- env: `APP_STORE_APP_APPLE_ID`, `APP_STORE_PRODUCT_IDS`, `APP_STORE_IAP_ISSUER_ID`,
  `APP_STORE_IAP_KEY_ID`
- Secret Manager: `APP_STORE_IAP_PRIVATE_KEY_BASE64`,
  `APP_STORE_ROOT_CA_CERTIFICATES_BASE64_JSON`

## 현재 Blocker

- support/privacy 공개 HTTPS URL 미확정, mobile `legalUrls`도 빈 값. Marketing URL은 의도적으로 생략
- 큐레이션 콘텐츠의 source revision·digest·라이선스 원문·배포 고지·사람 검수 미완료라
  `contentRights=review-required-before-submission`
- App Store Connect app/subscription, App Apple ID와 IAP key 설정 미완료
- Firebase project와 `GoogleService-Info.plist` 미생성
- App Privacy/연령등급/DSA/review 연락처/signing/TestFlight 미완료
- iPhone/iPad screenshot 0장, StoreKit sandbox 구매·복원·환불 E2E 미완료
- Server Notifications V2 URL/live callback과 Notification History scheduler/cursor/API 권한의
  sandbox·production 실행은 미검증(코드·cursor/rules 테스트는 완료)

공식 서버 검증 문서:

- https://developer.apple.com/documentation/appstoreserverapi/
- https://developer.apple.com/documentation/appstoreserverapi/get-notification-history
- https://developer.apple.com/documentation/storekit/validating-receipts-with-the-app-store
