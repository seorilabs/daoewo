# Release Targets

## 기본 Target

| Target | Repo 위치 | Artifact | 상태 |
| --- | --- | --- | --- |
| Google Play | `apps/mobile`, `play-store/` | `.aab` | `확정 필요` |
| App Store | `apps/mobile`, `app-store/` | Xcode archive / `.ipa` | `확정 필요` |
| AppsInToss | `apps/ait`, `apps-in-toss/` | `.ait` | `확정 필요` |

## Release Order

- First target: `확정 필요`
- Beta/internal testing path: `확정 필요`
- Production release path: `확정 필요`

## Shared Release Blockers

- Package name / bundle ID / AppsInToss appName 확정
- Firebase project strategy 확정
- Privacy/data safety/review note 확정
- Store assets 생성 및 검증
- Native launch/splash 화면 제품 브랜딩 검증
- TestFlight/internal testing/sandbox QA 완료
