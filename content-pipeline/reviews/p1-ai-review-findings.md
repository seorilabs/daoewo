# P1 AI 콘텐츠 검수 발견사항

작성일: 2026-07-14

## 판정

- 구조·수량·source allowlist·안전·저작권 휴리스틱: PASS
- 사람 사실 검수: 미완료
- 배포 판정: **승인 보류** (`awaiting-human-approval` 유지)

현재 `factual` 자동 QA는 source ID·revision·placeholder만 검사한다. 카드의 설명이 실제 출처와
일치하는지는 검증하지 않으며 AI 3덱의 `referenceTexts`도 비어 있다. 따라서 저장 record의
`qa.factual.passed=true`를 사실 검수 완료로 해석하면 안 된다.

이번 spot audit은 26개 coverage의 첫·중간·마지막 78장을 직접 읽고, AI 3덱 1,240장의
sourceRefs와 근접 중복을 자동 검사했다. 아래 digest의 local record에만 발견사항을 적용한다.

| 덱 | 카드 | record digest |
| --- | ---: | --- |
| 정보처리기사 요약 | 320 | `sha256:9e2f85a83c6c90cfa03a9b32661087325b5e74ddf7c6e53f91969ebbb3ea509b` |
| IT/CS 면접 용어 | 420 | `sha256:395892baceb9b0e1b99bf9d7e8ff8e5362e785a76bcc9783a2eca2daca42f2bf` |
| 한국사능력검정 핵심 | 500 | `sha256:4c80210f4fcd8319aa088ceb66140d5793743b2ff0a6d949179fcc2875f0ce6b` |

## 확인된 blocker

### 한국사능력검정 핵심

- `index=252`, `korean-history-cert-core.3094122c8536660c`: 『동국통감』을 세종 때
  편찬했다고 설명한다. 세조 때 착수해 성종 때 완성된 내용으로 고쳐야 한다. 같은 오기는
  `index=272`, `index=317`도 함께 확인한다.
  - 근거: [우리역사넷 - 동국통감](https://contents.history.go.kr/front/tg/view.do?levelId=tg_003_1000&treeId=0100)
- `index=458`, `korean-history-cert-core.e7b740e09548a7e9`: 신간회를 비밀단체로 설명한다.
  합법적 대중 민족운동 단체였다는 내용으로 고쳐야 한다.
  - 근거: [우리역사넷 - 신간회](https://contents.history.go.kr/mobile/kc/view.do?levelId=kc_o401900)
- `index=253`: 질문에 이미 정도전을 적고 답도 정도전인 문답 모순이다.

### 정보처리기사 요약

- `index=286`, `information-processing-engineer.da9a13e6952c81ac`: `ISO/IEC 25010:2023`
  출처에 구 `기능성(Functionality)` 분류를 혼용한다. 같은 coverage의 사용성·이식성 카드도
  묶어서 다시 확인한다.
  - 근거: [ISO/IEC 25010:2023](https://www.iso.org/standard/78176.html)
- `index=219`, `index=259`: OWASP Top 10:2025 출처에 2021 명칭인
  `Vulnerable and Outdated Components`를 사용한다. 2025판의
  `Software Supply Chain Failures` 범위로 다시 작성한다.
  - 근거: [OWASP Top 10:2025](https://owasp.org/Top10/2025/0x00_2025-Introduction/)

### IT/CS 면접 용어

- `index=179`: Index Only Scan이 항상 heap 접근을 피한다고 단정한다. visibility 확인 때문에
  heap 접근이 필요할 수 있다는 조건을 반영한다.
  - 근거: [PostgreSQL 18 - Index-Only Scans](https://www.postgresql.org/docs/18/indexes-index-only-scans.html)
- `index=276`, `it-cs-interview-terms.38cce0bce8d3db1d`: Java의 checked exception 설명에
  ECMAScript 사양을 출처로 연결했다. 카드 또는 sourceRef를 다시 작성한다.
- `index=399`, `it-cs-interview-terms.e3ddbbe4bd9893ff`: `Sensitive Data Exposure`를
  `인증 정보 노출`로 오역했다. `민감 데이터 노출`로 고친다.

## 검수 방법

카드 원문은 다음처럼 index로 확인한다.

```bash
jq '.cards[252]' content-pipeline/.work/korean-history-cert-core.json
jq '.cards[286]' content-pipeline/.work/information-processing-engineer.json
jq '.cards[276]' content-pipeline/.work/it-cs-interview-terms.json
```

앱 화면 확인은 repo root에서 Preview Metro와 Debug 앱을 각각 실행한다.

```bash
pnpm run dev:mobile:preview
pnpm run ios:mobile:preview
```

수정 후에는 record digest를 갱신하고 전체 QA·Preview 생성·사람 사실 검수를 다시 수행한다.
검수자 이름·시각·근거가 모두 기록되기 전에는 `approve`나 `publish`를 실행하지 않는다.
