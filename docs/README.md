# Docs Source Of Truth

이 폴더는 Seorilabs 비게임 앱 프로젝트의 실행 원장이다.

Obsidian은 지식베이스와 재사용 가능한 운영 노하우를 보조로 관리한다. 제품별 기획, 의사결정, 작업, 마켓 등록, 릴리스 상태는 이 `docs/`를 우선한다.

## 폴더

```text
01-planning/      # 제품 기획, 요구사항, 승인 상태
02-decisions/     # ADR, 장기 의사결정
03-architecture/  # Clean Architecture, dependency rule
04-work/          # 작업 로그, backlog
05-markets/       # Google Play, App Store, AppsInToss, Firebase 원장
06-release/       # 릴리스 후보, 배포 체크리스트
07-qa/            # 테스트 전략, QA 시나리오
08-ops/           # GitHub Actions, dependency, runner 운영
09-knowledge/     # Obsidian으로 승격하거나 가져온 일반 지식
```

## 문서 규칙

- 확인된 사실과 추정은 분리한다.
- 모르는 값은 `확정 필요`로 남긴다.
- 콘솔에서 변경한 값은 관련 문서와 config example에 반영한다.
- 릴리스 전에는 `pnpm run check:release`로 placeholder와 blocker를 확인한다.
