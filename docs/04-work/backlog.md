# Backlog

## 배포 전 승인·외부 설정 필요

- Firebase project ID·region·OAuth/App Check·native config
- Google Play/App Store/AIT 상품 ID와 영수증·webhook 운영 자격증명
- 이용약관·개인정보·지원·계정삭제 public URL
- 사람 승인 콘텐츠 본문과 실제 기기 기반 스토어 스크린샷
- Android production signing, Apple signing/TestFlight, 각 콘솔 설문·심사 정보
- release-candidate 검증 후 스토어 제출·프로덕션 공개 승인

## 승인됨

- 앱명 `다외워` / `Daoewo`, app id `daoewo`
- Android/iOS 식별자 `com.seorilabs.daoewo`
- Free 6덱·Pro 8덱 카탈로그, Free 1덱/일 60장 정책
- 월 4,900원·연 39,000원·7일 체험 기획값
- React Native + Firebase 멀티마켓 구조와 배포 승인 게이트

## P1 후속 구현

- Free 1-device opportunistic server backup/복구
- Pro 다기기 진도 hydrate E2E
- Google missed RTDN reconciliation 정책(Voided Purchases API scheduled pull + 필요 시 client reverify/KMS)
- claim 전 notification fingerprint pending marker + direct claim-only/grant-hold 2-phase
- Google missed renewal 자동 복구(client reverify 또는 승인된 KMS token 경계)
- Google `linkedPurchaseToken`의 old/new claim 원자 supersede와 계정 소유권 검증
- Google voided purchase의 latest/past renewal `orderId` ephemeral 검증·hashed audit와 API eventual-consistency 재조회 정책
- Apple Notification History cursor·scheduler 기반 누락 알림 reconciliation
- AppsInToss cold-start 세션 복구와 공식 구독 provider 연동
- 실제 TTS·FCM 알림·Remote Config 운영 검증

## P2 운영 하드닝

- 예산·예상 트래픽 확정 후 public Apple notification/Google RTDN의 `maxInstances`·`concurrency`·비용 알림 상한 설정
