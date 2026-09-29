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
| Learning sync | Free metadata-only backup·stale merge·Pro hydrate·계정 전환 격리 | Core/UI/Functions/Rules tests |
| Account lifecycle | current anonymous provider 검증·exact merge 응답 유실 멱등 복구·write transaction race 차단·v2 cleanup lease/trigger/sweeper·source Auth 폐기·target 탈퇴 marker 보존 | Functions service/trigger/Rules/Auth Emulator tests |
| Reconciliation | Voided/Notification History pagination·cursor reset·현재 store state 재조회 | Functions unit/service/Rules tests |
| Device settings | 계정 격리·TTS/voice guide·local daily/review rollback·share/export 최소화 | Product UI/Mobile/native tests |
| Remote Config/Crash | template/default parity·TTL 범위·kill-switch·고정 진단 allowlist | Scripts/Mobile tests |
| Deck update push | 계정별 opt-in 권한·token 회전/해제·ready revision/lease·operator claim·신규 publication multicast·foreground allowlist·민감정보 비노출 | Product UI/Mobile/Functions/Rules/Scripts tests |
| Content pipeline | Gemini/offline 생성·QA·사람 승인 경계 | `pnpm --filter @daoewo/content-pipeline check` |
| Content DEV Preview | 실제 source·자동 QA·미승인 상태만 허용, production entry 격리, 외부 capability 차단 | `pnpm run test:scripts`, `pnpm run test:mobile` |

## Device QA

- Android: 작은 portrait emulator와 실제 기기에서 cold start, 스와이프, 알림, 결제 sandbox
- iOS: iPhone simulator/실기기에서 cold start, Apple 로그인, StoreKit sandbox, 복원
- AppsInToss: `intoss://daoewo/` sandbox에서 첫 화면, 스와이프, Storage, 서버 API

2026-07-13 repo-local smoke에서는 iOS 18.1 iPhone 16 Pro(light)와 iPhone SE 3세대(dark)에서
onboarding, guest 진입, home, 14덱 catalog, 준비 중 detail, settings와 capability 문구를 실제
Simulator로 확인했다. Firebase/APNs·알림 권한·StoreKit·실기기 경로는 외부 설정 후 별도 검증한다.

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
    mutation과 동일 Toss UID 재가입 token 발급이 거부되는지 확인한다. merge commit 응답 유실은
    exact v2 marker 결과로 복구되고, stale anonymous token의 현재 linked source 병합은 거부되며,
    pending cleanup Auth 장애에서는 marker가 삭제되지 않는지도 확인한다. onCreate 누락·failed·expired
    claimed marker는 15분 bounded sweeper가 oldest-first로 회수하고, merge commit과 경합한
    goal/window/progress/request/store-event write는 transaction 내부 marker 확인으로 실패해야 한다.
13. 회원탈퇴 서버 처리는 성공했지만 응답이 유실·timeout된 경우에도 mobile/AIT 로컬
    `daoewo:*` cache가 남지 않는지 fault-injection으로 확인한다.
14. Free backup payload에 본문·UID·device hash가 없고, account switch 중 늦은 pull/push가
    새 계정 로컬 bundle/progress를 오염시키지 않는지 확인한다.
15. Google/Apple history page 처리 실패에서는 cursor가 전진하지 않고, vendor page token
    만료 시 같은 고정 window 첫 페이지로 reset한 뒤 idempotent하게 재처리하는지 확인한다.
16. 동일 덱 요청의 `queued → ready` revision이 outbox 하나만 만들고, 병합 후 현재 소유자에게만
    고정 문구 FCM을 보내며 active lease 동시 worker, invalid token/삭제 계정/재시도 한도를 안전하게 처리하는지 확인한다.
    device payload·outbox·로그·응답에 raw token/UID/topic/note/request/deck ID가 없는지도 함께
    검증한다.
17. published deck create/최초 전환만 현재 opt-in installation에 고정 신규 덱 문구를 multicast하고,
    재게시·임의 foreground kind·opt-out/탈퇴 계정 token은 알림 경로에 들어오지 않는지 확인한다.
18. 콘텐츠 Preview artifact는 `awaiting-human-approval` 실제 source record만 포함하고, Debug 전용
    entry에서만 열리며 Analytics·동기화·구매·공유·알림·덱 요청을 외부로 보내지 않는지 확인한다.

## Release Inventory Assertions

`pnpm run check:release`는 다음을 동적으로 검사한다.

- 사설 IP·예약/placeholder host를 거부하는 public HTTPS support/terms/privacy URL과
  mobile/AIT runtime legal URL. App Store Marketing URL은 빈 값 허용
- Play/App Store config·mobile runtime·Functions allowlist 월/연 SKU parity,
  mobile Google client ID, Firebase project/native config
- AIT API base/Firebase key와 placeholder icon URL
- Google/App Store receipt env·Secret Manager wiring(값은 출력하지 않음)
- AppsInToss official partner provider가 여전히 fail-closed인지 여부
- Free backup/Pro hydrate, missed-renewal reverify, store reconciliation scheduler/cursor 구조
- config에 등록된 실제 screenshot 최소/최대 수, global path 중복, manifest `kind=screenshot`,
  market별 경로·치수·alpha와 파일 존재 여부
- v1 manifest 14덱/P1 7덱 전부의 `status=published`, reviewer 이름·시각·근거,
  provenance digest·immutable source revision과 human-approved published body. `generate-catalog.mjs
  --check`로 source/publication 승인 snapshot, workflow, chunk checksum, generated artifact도 대조
- App Store metadata UTF-8 keyword 100-byte 제한, content rights와 실제 SDK privacy inventory.
  `PrivacyInfo.xcprivacy`는 plist 구조로 parse해 11개 type별 Linked/Tracking/Purposes를 exact match
- App Store raw IAP private key를 받지 않는 GitHub configured marker와 Functions secret wiring

현재 screenshot 0장, published body 0개, runtime/config 빈 값 때문에 expected FAIL이다.

## Regression Rules

- core 변경은 device 없이 검증 가능한 테스트를 먼저 추가한다.
- adapter 변경은 target-specific smoke를 추가한다.
- market policy나 SDK 데이터 수집 변경은 `docs/05-markets/`와 privacy/data safety 문서를 함께 갱신한다.
- native startup 변경은 cold start를 확인한다. iOS `LaunchScreen`과 Android splash/launch theme에서 React Native 또는 framework template 문구가 보이면 release blocker다.
- release checker를 통과시키려고 빈 config를 placeholder, 기획 가격, 승인 전 콘텐츠로
  대체하지 않는다.
