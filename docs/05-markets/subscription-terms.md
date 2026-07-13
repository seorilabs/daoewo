# 구독·복원 정책 원장

- 월간 ₩4,900, 연간 ₩39,000, 신규 7일 체험을 기획 기준으로 한다.
- 앱에는 스토어가 반환한 현지 가격, 청구 주기, 체험 가능 여부를 표시한다.
- 자동 갱신, 해지 시점, 체험 후 청구, 이용약관·개인정보처리방침 링크를 페이월 결제 CTA 근처에 표시한다.
- 구매·복원·만료·환불·grace/billing retry 결과는 서버 검증 entitlement가 권위다.
- 익명 사용자는 복원 가능한 Google/Apple 계정 연결을 안내하되, 기존 progress를 잃지 않고 링크해야 한다.
- AppsInToss는 공식 정기결제 API를 사용하되 미지원 Toss App 버전에서는 Free-only로 graceful fallback한다. Sandbox 미지원 때문에 실제 결제 검증은 별도 release gate다.

Play/App Store 상품 ID, 약관 URL, 개인정보처리방침 URL은 콘솔/공개 문서 생성 후 machine config에 기록한다.

## 현재 구현·설정 상태

- mobile 월/연 product ID, Google Web client ID, terms/privacy URL: 빈 값
- AIT API base/Firebase API key/terms/privacy URL: 빈 값
- Play/App Store config 월/연 product ID와 support/privacy URL: `확정 필요`
- 두 store config, mobile runtime과 Functions allowlist SKU가 모두 같아야 release checker 통과
- Functions Google Play/App Store server provider: 구현됨. 상품 allowlist·IAP key/env/secret과
  runtime IAM이 없으면 store별로 fail-closed
- Functions AppsInToss partner/receipt provider: official partner 계약·mTLS 인증서 미연결로
  unconfigured/fail-closed
- store screenshot: 전 마켓 0장

앱은 위 값이 없을 때 기획 가격이나 7일 체험을 확정된 offer처럼 표시하지 않는다. 각
스토어가 반환한 현지 가격·청구 주기·실제 eligible offer가 있을 때만 표시한다.
