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

사람 승인 완료 Free 본문·목표·진도는 계정별 AppsInToss Storage에 번들/캐시되지만 현재는
**local-only**다. 기존 기획의 1-device 서버 backup/sync를 구현한 것으로 보지 않으며,
로그아웃 시 scoped local state를 지운다. opportunistic backup은 별도 P1 release blocker다.

## 로컬 검증

```bash
pnpm --filter @daoewo/ait lint
pnpm --filter @daoewo/ait typecheck
pnpm --filter @daoewo/ait test --runInBand
pnpm --filter @daoewo/ait build
```

후보 산출물은 `apps/ait/daoewo.ait`다. `.ait` 생성은 콘솔 등록, 이미지 업로드,
Sandbox QA, 정기결제 검증 완료를 뜻하지 않는다.

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
