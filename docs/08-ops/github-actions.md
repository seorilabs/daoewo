# GitHub Actions

## Workflows

- `Repository Checks`: core, architecture, docs checks.
- `Release Inventory`: manual release blocker inventory.
- `Build AppsInToss Candidate`: manual `.ait` candidate build.
- `Build Android Candidate`: manual Android AAB candidate build.
- `Build iOS Candidate`: manual iOS archive handoff workflow.

## Runner Routing

- 템플릿 workflow는 public/private 양쪽에서 안전하게 동작하도록 `github.event.repository.private` 조건을 둔다.
- private repo의 JS/TS/docs/AIT candidate는 `seorilabs-rpi-arm64`를 우선 사용한다.
- public repo 또는 public PR path에서는 `ubuntu-latest` fallback을 사용한다.
- Android release build는 RPI ARC로 보내지 않고 `ubuntu-latest` x64 Linux runner를 사용한다.
- App Store/Xcode build는 RPI ARC로 보내지 않고 `macos-latest` runner를 사용한다.

## Central Source

수정 전 확인:

```bash
cat /Users/syous/Workspace/kubectl/github-actions-runners/global-versions.yaml
```

2026-06-16 확인값:

- `seorilabs-rpi-arm64`: `minRunners: 2`, `maxRunners: 4`
- `seorilabs-rpi-arm64-dind`: `minRunners: 0`, `maxRunners: 1`
- Node: `24.16.0`

수치는 운영 중 바뀔 수 있으므로 workflow 수정 전 중앙 파일을 다시 확인한다.

## Runner Group Membership

2026-06-16 확인:

- Repo: `seorilabs/starter-template-app`
- Visibility: private
- GitHub template: enabled
- Runner group: `RPI ARM64 Builders`
- Runner group ID: `3`
- Repo ID: `1270901663`

신규 private repo는 `RPI ARM64 Builders`가 selected visibility라 repo membership 추가가 필요했다. membership 추가 전 push-triggered `Repository Checks`는 queued 상태로 남았고, 추가 후 workflow_dispatch run은 성공했다.
