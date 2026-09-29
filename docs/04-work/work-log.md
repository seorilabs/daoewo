# Work Log

## 2026-07-12

- 승인된 다외워 실행 기획을 `com.seorilabs.daoewo` 멀티마켓 저장소로 구현했다.
- 공통 도메인·11개 제품 화면·Free 오프라인 번들·Firebase Functions/Rules·영수증 검증·콘텐츠 승인 파이프라인을 추가했다.
- Google Play/App Store/AppsInToss 등록 메타데이터와 브랜드 이미지 5종을 exact size로 준비했다.
- iOS Simulator Debug build/runtime QA, Android Release AAB build, AppsInToss `.ait` build를 통과했다.
- 실제 Firebase project·상품·법적 URL·스토어 스크린샷·서명·AIT 구독 provider는 배포 승인 전 blocker로 유지한다.

## 2026-07-14

- P1 콘텐츠 7덱 6,018장을 생성했다: 영어 600/1,250장, 일본어 240/2,688장, 한국사 500장, 정보처리기사 320장, IT·CS 면접 420장.
- 어휘 4덱은 commit과 입력 SHA-256을 고정한 `vocab-swipe` snapshot에서 가져오고, AI 3덱은 20장 coverage slot·source allowlist·재개 가능한 Gemini 운영 batch로 생성했다.
- 자동 QA를 통과한 결과는 모두 `awaiting-human-approval`과 reviewer `pending`에서 멈췄으며 승인·청크·서버 업로드·프로덕션 공개는 수행하지 않았다.
- AI 3덱 78장 spot audit에서 사실·출처 blocker를 확인해 `content-pipeline/reviews/p1-ai-review-findings.md`에 고정했고, 사람 검수 전 승인을 계속 차단했다.
- gitignored `.work` 레코드를 7덱/6,018장 Debug 전용 mobile artifact로 검증·변환하는 콘텐츠 Preview를 추가했다. Preview에서는 Analytics·동기화·구매·공유·알림·덱 요청을 비활성화한다.
- 연결된 iPhone 12 Pro에 Preview 전용 Debug 앱을 설치했다. `index.preview.js`를 Hermes
  `preview.jsbundle`로 앱에 포함해 Metro 8082가 닿지 않아도 실기기에서 확인 가능하게 했으며,
  자동 실행만 잠긴 기기의 iOS 정책으로 거부됐다.
- 전체 test, lint, typecheck, architecture/docs gate와 iOS Preview 실기기 build를 통과했다.
