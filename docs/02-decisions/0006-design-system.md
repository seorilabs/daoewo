# ADR 0006: 모바일 자체 디자인 시스템과 AIT TDS 경계

- 상태: Accepted
- 날짜: 2026-07-12

## 결정

공통 RN 화면은 `packages/product-ui`에서 `#4C6FFF` 기반 자체 토큰으로 구현한다. Android/iOS는 이 UI를 직접 사용하고, AppsInToss는 `TDSProvider`와 안전영역/Storage/로그인 등 런타임 어댑터로 감싼다.

공통 원칙은 화면당 주요 행동 1개, 충분한 여백, 16px 이상 본문, 라운드 카드, 정답 초록·오답 빨강·복습 앰버의 의미색, 다크모드, 동적 글자 크기, 접근성 action이다. 첫 화면과 네이티브 launch surface에는 제품명/브랜드만 표시하고 프레임워크 템플릿 문구를 금지한다.
