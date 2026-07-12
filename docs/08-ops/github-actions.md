# GitHub Actions

## Workflows

- `Static Checks`: RPI org 재사용 job으로 lint/typecheck/test/core/architecture/docs/assets,
  `ubuntu-latest` + Java 21 별도 job으로 Firebase Rules emulator 검사.
- `Release Inventory`: manual release blocker inventory.
- `Deploy AppsInToss`: explicit dispatch/tag에서 `.ait` build·배포.
- `Deploy Google Play`: explicit dispatch/tag에서 x64 Linux AAB build, 선택적 upload.
- `Deploy App Store`: explicit dispatch/tag에서 macOS archive, 선택적 upload.
- `Deploy All`: 한 release tag를 세 마켓 caller로 전달.
- `Release Tag`: release tag·notes 생성, `Nightly`는 AIT canary만 수행.
- `Cleanup Actions Storage`: 중앙 보존 정책에 따른 수동 정리.

## Runner Routing

- 템플릿 workflow는 public/private 양쪽에서 안전하게 동작하도록 `github.event.repository.private` 조건을 둔다.
- private repo의 JS/TS/docs/AIT candidate는 `seorilabs-rpi-arm64`를 우선 사용한다.
- public repo 또는 public PR path에서는 `ubuntu-latest` fallback을 사용한다.
- Android release build는 RPI ARC로 보내지 않고 `ubuntu-latest` x64 Linux runner를 사용한다.
- App Store/Xcode build는 RPI ARC로 보내지 않고 `macos-26` runner를 사용한다.

## Central Source

수정 전 확인:

```bash
cat /Users/syous/Workspace/kubectl/github-actions-runners/global-versions.yaml
```

2026-07-12 중앙 파일 확인값(운영 중 변경 가능):

- `seorilabs-rpi-arm64`: `minRunners: 2`, `maxRunners: 4`
- `seorilabs-rpi-arm64-dind`: `minRunners: 0`, `maxRunners: 1`
- Node: `24.16.0`

수치는 운영 중 바뀔 수 있으므로 workflow 수정 전 중앙 파일을 다시 확인한다.

## Runner Group Membership

신규 `seorilabs/daoewo`는 private repo로 만들고 `RPI ARM64 Builders` selected repository membership을 확인해야 한다. public 전환 시 self-hosted ARC를 PR 경로에 노출하지 않는다.
