# Dependencies

## Package Manager

- pnpm: `11.3.0`
- Node in Seorilabs ARC: `24.16.0`
- Root engine: `>=24 <27`

## React Native

2026-06-16 확인값:

- `react-native`: `0.86.0`
- `react`: `19.2.7`
- `@react-native-community/cli`: `20.1.3`
- `typescript`: `6.0.3`

정책:

- 템플릿에는 native app을 미리 생성하지 않는다.
- 새 프로젝트 생성 시 `pnpm run bootstrap:mobile -- <AppName>`으로 Community CLI 최신 stable 기반 native project를 만든 뒤 lockfile을 커밋한다.
- RN native dependency는 실제 target 생성 후 `apps/mobile/package.json`과 lockfile 기준으로 확정한다.

## AppsInToss

2026-06-16 npm 확인값:

- `@apps-in-toss/framework`: `2.8.0`
- `@toss/tds-react-native`: `2.0.3`
- `react-native-safe-area-context`: `5.8.0`

정책:

- 신규 AppsInToss 비게임 app은 Granite RN + TDS React Native를 사용한다.
- `apps/ait` 생성 후 `granite.config.ts`와 AppsInToss console 값을 `docs/05-markets/apps-in-toss.md`에 반영한다.
- `.ait` artifact는 기본적으로 커밋하지 않는다.

## Firebase

2026-06-16 npm 확인값:

- `firebase`: `12.14.0`
- `@react-native-firebase/app`: `24.1.1`

정책:

- `apps/mobile`은 native Firebase module을 우선 검토한다.
- `apps/ait`은 native Firebase module을 가정하지 않는다. AIT runtime 검증 전에는 server API 또는 constrained adapter로 둔다.
- Firebase가 필요 없는 local-only MVP에는 Firebase 코드를 미리 추가하지 않는다.

## GitHub Actions

2026-06-16 GitHub Releases API 확인 기준:

- `actions/checkout@v6`
- `actions/setup-node@v6`
- `actions/setup-java@v5`
- `actions/upload-artifact@v7`

## Policy

- SDK 버전은 실제 프로젝트 생성 시 공식 문서와 repo-local lockfile로 확정한다.
- `@latest`나 branch ref보다 확인된 stable major tag를 선호한다.
- Dependabot은 GitHub Actions와 root npm ecosystem을 감시한다.
