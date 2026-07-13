# Backlog

## 배포 전 승인·외부 설정 필요

- Firebase project ID·region·OAuth/App Check·native config
- Google Play/App Store/AIT 상품 ID와 영수증·webhook 운영 자격증명
- 이용약관·개인정보·지원·계정삭제 public URL
- App Store/Play 실제 SDK 개인정보 답변과 큐레이션 content rights 승인
- 사람 승인 콘텐츠 본문과 실제 기기 기반 스토어 스크린샷
- Android production signing, Apple signing/TestFlight, 각 콘솔 설문·심사 정보
- release-candidate 검증 후 스토어 제출·프로덕션 공개 승인

## 승인됨

- 앱명 `다외워` / `Daoewo`, app id `daoewo`
- Android/iOS 식별자 `com.seorilabs.daoewo`
- Free 6덱·Pro 8덱 카탈로그, Free 1덱/일 60장 정책
- 월 4,900원·연 39,000원·7일 체험 기획값
- React Native + Firebase 멀티마켓 구조와 배포 승인 게이트

## 구현 완료·live 검증 대기

- Free 1-device opportunistic server backup/복구와 Pro 다기기 진도 hydrate
- claim 전 notification fingerprint barrier + direct claim-only/grant-hold 2-phase
- Google Voided Purchases와 Apple Notification History scheduler/cursor reconciliation
- Google past/current renewal `orderId` ephemeral 교차검증과 hash-only audit
- Google missed renewal mobile 세션당 client reverify
- Google `linkedPurchaseToken` old/new claim 원자 supersede
- AppsInToss UID-marker 기반 cold-start session 복구(민감 token 비저장)
- 계정별 6종 설정, Android/iOS TTS·로컬 09시/복습 알림, 실제 공유·본문 없는 JSON 내보내기
- allowlist Remote Config 카탈로그 TTL/신규·요청 덱 kill-switch와 PII-safe Crashlytics 경계
- mobile opt-in FCM 설치 lifecycle + 덱 요청 ready revision 결정적 outbox/발송/merge/delete 경계

위 항목은 자동 테스트를 통과했지만 Firebase/스토어 sandbox의 IAM·endpoint·동시 race·실결제
E2E 전에는 release 완료가 아니다.

## P1 후속 구현

- AppsInToss 공식 구독 provider와 스마트 메시지 template/mTLS 발송 adapter 연동
- Firebase/APNs 실기기 FCM 수신, Remote Config publish, Crashlytics 운영 검증

## P2 운영 하드닝

- 예산·예상 트래픽 확정 후 public Apple notification/Google RTDN의 `maxInstances`·`concurrency`·비용 알림 상한 설정
