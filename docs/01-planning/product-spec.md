# 다외워 제품 명세

## 상태와 식별자

| 항목 | 값 |
| --- | --- |
| Lifecycle | `build` |
| Planning approval | 2026-07-12 승인 |
| Deployment approval | 미승인 — 제출·프로덕션 공개 금지 |
| 한글/영문명 | 다외워 / Daoewo |
| Android/iOS ID | `com.seorilabs.daoewo` |
| AppsInToss appName | `daoewo` |
| 대표색 | `#4C6FFF` 구현 기준, 등록 전 사람 최종 확인 |
| 분석 prefix | `memo` |

## 제품

스와이프 플래시카드, 간격 반복(SRS), 기간·분량 목표, 오답노트를 콘텐츠 종류와 무관하게 제공한다. 운영자가 수요를 발굴하고 AI 배치 생성·사람 검수·라이선스 확인을 거친 큐레이션 덱을 공급한다. 사용자는 덱을 소비하거나 새 덱을 요청하며, 즉석 AI 생성과 수동 커스텀 덱은 v1 범위가 아니다.

핵심 흐름은 `게스트/로그인 → 덱 선택 → 목표 설정 → 오늘 카드 스와이프 → 오답 복습 → 완료 통계`다. 스와이프 방향은 **왼쪽=모르겠다, 오른쪽=안다**로 고정한다.

## Free / Pro

| 기능 | Free | Pro |
| --- | --- | --- |
| 학습·SRS·오답노트·기본 통계 | 지원 | 지원 |
| 덱 | 무료 tier 전체 | 전체 |
| 동시 활성 덱 | 1 | 제품 한도 없음 |
| 일일 학습 | 60장 | 제품 한도 없음 |
| 동기화 | 등록 기기 1대 백업 | 다기기 |
| 고급 통계·신규 덱·요청 우선 | 미지원 | 지원 |

월 ₩4,900, 연 ₩39,000, 7일 무료 체험을 사용한다. 표시 가격과 체험 가능 여부의 최종 권위는 각 스토어 응답이다. Pro의 제품 한도 없음과 콘텐츠 대량 추출 방지 soft-cap은 별개다.

## 콘텐츠와 오프라인

- v1 목표: 14덱(Free 6 / Pro 8), P1 7덱 우선.
- Free 본문은 번들/캐시로 완전 오프라인을 지원한다.
- Pro 본문 전체는 클라이언트에 전달하지 않는다. 서버가 오늘 배정분과 도래 복습만 24시간 창으로 전달한다.
- 카탈로그 메타는 Free 사용자에게도 Pro 잠금 상태로 공개한다.

## 범위 밖

- 사용자 즉석 AI 덱 생성, 수동 커스텀 덱, 공개 덱 마켓플레이스
- 초등(K-6) 대상 콘텐츠와 아동 계정 정책(phase 2)
- 광고 기반 수익화
- 별도 배포 승인 전 스토어 제출·프로덕션 공개

## Architecture

- Core entities: `Deck`, `Card`, `StudyGoal`, `CardProgress`, `ReviewQueueItem`, `CalendarDayState`, `Entitlement`, `DeckRequest`
- Pure use cases: 목표 배분, 스와이프 분류, SRS, 복습 큐, 통계/스트릭, 권한, 카탈로그 필터
- Ports: Storage/Auth/Sync/Catalog/SessionDelivery/ProgressSync/DeckRequest/Entitlement/Analytics/Clock/RemoteConfig/Notification
- Mobile: bare React Native + native Firebase/Play Billing/StoreKit adapter
- AppsInToss: Granite RN + TDS + AppsInToss-safe storage/server adapter
- Server: Functions가 동일 core를 실행하고 Firestore/Cloud Storage를 권위 저장소로 사용
