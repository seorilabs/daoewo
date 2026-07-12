# 다외워 모바일

Google Play와 App Store용 bare React Native 0.86 타깃이다. 공통 화면은
`@daoewo/product-ui`, 규칙은 `@daoewo/product-core`, 공개 카탈로그 메타는
`@daoewo/product-catalog`를 사용한다.

## Runtime 설정

`src/runtime-config.ts`가 공개 runtime 식별자의 원장이다.

- `firebaseEnabled`: Firebase 앱 등록·native config가 모두 준비된 뒤에만 `true`
- `googleWebClientId`: Google 로그인용 Web client ID
- `subscriptionProductIds.monthly` / `annual`: Play와 App Store에 실제 등록한 상품 ID
- `legalUrls.terms` / `privacy`: 결제 CTA에서 여는 공개 HTTPS 약관 URL

현재 위 값은 비어 있거나 비활성 상태다. `android/app/google-services.json`과
`ios/Daoewo/GoogleService-Info.plist`도 아직 없으므로 앱은 Free-only local runtime으로 시작하고,
로그인·동기화·구매·복원은 fail-closed 된다. 빈 상품 ID나 가격/체험 문자열을 UI에 대신
표시하지 않는다.

승인된 Free 본문·목표·진도는 계정별 로컬 key에 번들/캐시되어 네트워크 없이 학습할 수
있다. Firebase 익명 로그인을 새로 만들 수 없는 완전 오프라인 상태에서는 scoped local
guest를 사용하고, 이후 로그인 성공 시 해당 Free 상태를 UID key로 옮긴다. 현재 이 경로는
**local-only**이며 기존 기획의 1-device 서버 backup/sync를 아직
대체하지 않는다. 로그아웃 시 scoped local state를 지우며, Firebase opportunistic backup은
별도 P1 release blocker다.

## 로컬 검증

저장소 루트에서 실행한다.

```bash
pnpm --filter @daoewo/mobile typecheck
pnpm --filter @daoewo/mobile test --runInBand
pnpm --filter @daoewo/mobile start
pnpm --filter @daoewo/mobile android
pnpm --filter @daoewo/mobile ios
```

iOS native dependency가 바뀌면 다음을 먼저 실행한다.

```bash
cd apps/mobile/ios
bundle exec pod install
```

`scripts/restore-mobile-firebase-config.mjs --ios --require`는 검증된 plist를 위 경로에
복원하고 Google 로그인용 reversed client URL scheme을 `Info.plist`에 주입한다. 설정이
없는 Debug simulator는 offline runtime으로 빌드되지만 Release는 native config 없이 실패한다.

Android는 저장소의 `.java-version`에 맞춰 Temurin JDK 21을 사용한다. release 후보는
`apps/mobile/android/app/build/outputs/bundle/release/app-release.aab` 존재만으로 완료가
아니며, signing·Play App Signing·internal track QA가 별도 게이트다.

## 구독 권위

클라이언트는 스토어가 반환한 현지 가격·청구 주기·실제 체험 자격만 표시한다. 구매 시작 시
Firebase UID에 결정적으로 묶인 Play `obfuscatedExternalAccountId` 또는 Apple
`appAccountToken`을 전달하고, 권한은 Functions의 서버 영수증 검증 결과만 따른다.

출시 전에는 다음이 모두 필요하다.

- Play/App Store 월·연 상품 생성과 mobile/runtime/Functions allowlist 일치
- Google Play Developer API runtime service account 권한
- App Store App Apple ID, IAP issuer/key ID, Secret Manager private key·Apple root 인증서
- 구매·복원·환불·grace/billing retry sandbox 검증
- 공개 이용약관·개인정보처리방침 URL

실제 blocker는 저장소 루트의 `pnpm run check:release`로 확인한다.
