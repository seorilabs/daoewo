# Test Strategy

## Layer

| Layer | 목적 | 명령/위치 |
| --- | --- | --- |
| Core unit | domain/use case 순수 로직 | `pnpm run test:core` |
| Architecture | core import boundary | `pnpm run check:architecture` |
| Docs | docs source-of-truth 구조 | `pnpm run check:docs` |
| Mobile target | RN Android/iOS target 초기화 | `pnpm run check:mobile` |
| AIT target | Granite RN target 초기화 | `pnpm run check:ait` |
| Release inventory | market/release blocker | `pnpm run check:release` |
| Functions | 세션창·진도·쿼터·요청·영수증 경계 | `pnpm run test:functions` |
| Firebase rules | 사용자 격리·메타 공개·본문 deny | Emulator Suite |
| Mobile unit | 공통 UI와 mobile adapter | `pnpm run test:mobile` |
| AIT unit/build | TDS wrapper·Storage·`.ait` | `pnpm run test:ait`, `pnpm run build:ait` |
| Receipt provider | Play/App Store API 응답·account binding·환불/만료 fail-closed | `pnpm --filter @daoewo/functions test` |
| Content pipeline | Gemini/offline 생성·QA·사람 승인 경계 | `pnpm --filter @daoewo/content-pipeline check` |

## Device QA

- Android: 작은 portrait emulator와 실제 기기에서 cold start, 스와이프, 알림, 결제 sandbox
- iOS: iPhone simulator/실기기에서 cold start, Apple 로그인, StoreKit sandbox, 복원
- AppsInToss: `intoss://daoewo/` sandbox에서 첫 화면, 스와이프, Storage, 서버 API

## 핵심 시나리오

1. 게스트로 Free 덱 목표를 만들고 오늘 분량을 완료한 뒤 오답 복습을 수행한다.
2. 왼쪽/오른쪽 제스처와 버튼/접근성 action이 각각 unknown/known으로 동일 기록된다.
3. Free 두 번째 활성 덱, 61번째 카드, Pro 덱, 고급 통계에서 컨텍스트 페이월이 열린다.
4. Free 사용자도 Pro 메타를 보지만 카드 원본/미래 창은 직접 읽지 못한다.
5. Pro 구매·복원·만료/환불과 다기기 동기화가 서버 entitlement와 일치한다.
6. 목표 리셋 churn, device/user quota 우회, App Check 누락 요청이 throttle/deny 된다.
7. Free 오프라인과 Pro 창 TTL 만료·재연결·batch progress 충돌을 검증한다.
8. 12개 `memo_*` 이벤트가 PII 없이 정확한 파라미터로 발생한다.
9. mobile/AIT runtime의 상품 ID·legal URL·Firebase 값이 비면 가격/체험/구매 CTA와
   서버 권한이 fail-closed 되는지 확인한다.
10. Play `obfuscatedExternalAccountId`와 Apple `appAccountToken`이 로그인 UID에 묶이고,
    다른 UID/상품/package/bundle/환불 receipt가 거부되는지 확인한다.
11. AIT SDK callback이나 검증되지 않은 webhook JSON만으로 Pro가 부여되지 않고,
    unconfigured partner provider가 명시적으로 실패하는지 확인한다.
12. target 탈퇴 뒤 병합 source가 영구 deletion tombstone으로 전환되고 stale/revoked token의
    mutation과 동일 Toss UID 재가입 token 발급이 거부되는지 확인한다.
13. 회원탈퇴 서버 처리는 성공했지만 응답이 유실·timeout된 경우에도 mobile/AIT 로컬
    `daoewo:*` cache가 남지 않는지 fault-injection으로 확인한다. 이 로컬 wipe 변경은 target별
    충돌 검토 뒤 별도 구현한다.

## Release Inventory Assertions

`pnpm run check:release`는 다음을 동적으로 검사한다.

- public HTTPS support/terms/privacy URL과 mobile/AIT runtime legal URL
- mobile Google client ID·월/연 상품 ID, Firebase project/native config
- AIT API base/Firebase key와 placeholder icon URL
- Google/App Store receipt env·Secret Manager wiring(값은 출력하지 않음)
- AppsInToss official partner provider가 여전히 fail-closed인지 여부
- config에 등록된 실제 screenshot 수와 파일 존재 여부
- human-approved published body 수, 로컬 Gemini P1 approval-pending draft 참고 수

현재 screenshot 0장, published body 0개, runtime/config 빈 값 때문에 expected FAIL이다.

## Regression Rules

- core 변경은 device 없이 검증 가능한 테스트를 먼저 추가한다.
- adapter 변경은 target-specific smoke를 추가한다.
- market policy나 SDK 데이터 수집 변경은 `docs/05-markets/`와 privacy/data safety 문서를 함께 갱신한다.
- native startup 변경은 cold start를 확인한다. iOS `LaunchScreen`과 Android splash/launch theme에서 React Native 또는 framework template 문구가 보이면 release blocker다.
- release checker를 통과시키려고 빈 config를 placeholder, 기획 가격, 승인 전 콘텐츠로
  대체하지 않는다.
