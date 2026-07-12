# ADR 0001: Docs As Source Of Truth

## Status

Accepted

## Context

이전 작업에서는 기획, 작업 기록, 마켓 정보가 Obsidian과 git repo에 섞여 관리될 수 있었다. 앱 템플릿은 GitHub template로 복제되어야 하므로 repo 안에 실행 원장이 필요하다.

## Decision

제품별 기획, 의사결정, 작업, 마켓 등록, 릴리스 상태의 원장은 `docs/`로 둔다. Obsidian은 범용 지식과 재사용 가능한 운영 노하우를 보조로 관리한다.

## Consequences

- store console에서 바뀐 값은 `docs/05-markets/`와 market config에 반영해야 release-ready로 본다.
- Obsidian 단독 기록은 제품 릴리스 상태의 source of truth가 아니다.
- `pnpm run check:docs`와 `pnpm run check:release`가 docs 원장 누락을 드러낸다.
