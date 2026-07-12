# Release Targets

## 기본 Target

| Target | Repo 위치 | Artifact | 상태 |
| --- | --- | --- | --- |
| Google Play | `apps/mobile`, `play-store/` | signed `.aab` | 구현 중 |
| App Store | `apps/mobile`, `app-store/` | Xcode archive / `.ipa` | 구현 중 |
| AppsInToss | `apps/ait`, `apps-in-toss/` | `.ait` | 구현 중 |

## Release Order

- First target: Google Play internal과 AppsInToss sandbox 병행, iOS TestFlight 후속
- Beta/internal testing path: Play internal → closed, TestFlight internal, AIT sandbox
- Production release path: release-candidate 증거 검토와 별도 deployment approval 후 명시적 tag/dispatch

## Shared Release Blockers

- KIPRIS 문자상표와 AppsInToss `daoewo` 중복 권위 확인
- Firebase project ID/region/OAuth/App Check provider 확정
- Privacy/data safety/review note 확정
- Store assets 생성 및 검증
- Native launch/splash 화면 제품 브랜딩 검증
- TestFlight/internal testing/sandbox QA 완료
- Play/App Store 구독 상품과 AIT 구독 지원 범위 확정
