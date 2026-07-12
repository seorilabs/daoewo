# ADR 0005: 구독 권한과 기기 동기화 경계

- 상태: Accepted
- 날짜: 2026-07-12

## 결정

클라이언트는 `EntitlementPort`만 사용한다. Play Billing과 StoreKit 영수증은 서버 provider가 검증하며 Firestore entitlement 또는 Custom Claims를 권위로 삼는다. 검증 provider가 구성되지 않았거나 실패하면 잠금은 fail-closed다.

Free의 클라우드 백업은 `primaryDeviceId` 한 대만 pull/push할 수 있다. Pro는 계정에 연결된 여러 기기에서 동기화한다. 익명 구매는 복원 가능한 계정 연결을 안내하고, 익명→Google/Apple 계정 링크 시 progress와 entitlement를 서버에서 병합한다.

AppsInToss는 RN SDK v1.12.0 정기결제를 사용한다. 구버전에서는 구매 CTA를 숨기고 Free 기능을 유지한다. Sandbox App은 아직 구독 테스트를 지원하지 않으므로 서버 mTLS 검증, webhook, pending-order 복구, 실제 지원 Toss App에서의 검증을 release blocker로 둔다.
