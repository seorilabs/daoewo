# vocab-swipe 콘텐츠 import 경계

## 기준 snapshot

- 원천 repo: `https://github.com/seorilabs/vocab-swipe`
- 이 manifest가 확인한 commit: `e1ba2d5503d1f90ee9d6995c80070b0e2e3152e6`
- 가져올 수 있는 범위: 해당 commit의 generated 데이터와 자체 보강 데이터 중, 아래 라이선스 성분과 provenance를 카드 단위로 보존할 수 있는 항목.
- 가져오지 않는 범위: UI·앱 코드, 출처가 불명확한 데이터, 원천 revision이 움직이는 branch만 적힌 새 fetch 결과, 권리를 확인하지 않은 이미지·음성.

`source.commit`은 실제 bytes를 담은 vocab-swipe snapshot을 고정한다. `source.revision`은 그 snapshot 안 generated 파일이 기록한 원천 revision을 함께 남긴다. 새로 upstream을 fetch할 때는 branch(`main`, `master`, `latest`)만 기록하면 실패로 취급하고 아래 추가 pin을 확보해야 한다.

importer는 source repo의 현재 branch나 working tree 파일을 읽지 않는다. 반드시 아래처럼 `git show <commit>:<path>`로 blob을 읽고 SHA-256을 대조한다. 한 파일이라도 다르면 전체 import를 중단한다.

| 입력 ID | snapshot 경로 | SHA-256 | 라이선스 성분 |
| --- | --- | --- | --- |
| `vocab-swipe-toeic-word-list` | `packages/product-core/src/data/toeic-word-list.generated.ts` | `565963b0e71deb90931750971b36bd7e8d4c3b05dffd6edaf9343b1dbadf034a` | TSL CC BY-SA 4.0, WordNet 3.0 |
| `vocab-swipe-toeic-korean-glosses` | `packages/product-core/src/data/toeic-korean-glosses.ts` | `25b514eb7278e3c74e85d21256c868c7bf9e2606b29aaa2295fe4e2da0371c65` | Seorilabs 자체 작성 |
| `vocab-swipe-toeic-self-authored-enrichment` | `packages/product-core/src/data/toeic-self-authored-enrichment.ts` | `5e50df05597354955feda1d3b5532a6f7d8f918a622253fcde6886cdeffef823` | Seorilabs 자체 작성 |
| `vocab-swipe-jlpt-word-list` | `packages/product-core/src/data/jlpt-word-list.generated.ts` | `57c15bfc3f1591d24a54e3cb6f7d9b1eabb5c09145ea5fa5761d7fb77c2a978d` | MIT |
| `vocab-swipe-jlpt-korean-enrichment` | `packages/product-core/src/data/jlpt-korean-enrichment.generated.ts` | `61fdad1ef892548453b9457e46e9502a7c264229c5a53645c2981bedf488c8fa` | Seorilabs 자체 생성, 사람 검수 대기 |

생성 record의 `sourceRegistry`에는 repository commit 항목과 사용한 각 blob의 경로, commit, SHA-256, 라이선스 성분을 함께 기록한다. 카드는 실제 필드 입력 파일 ID를 `sourceRefs`로 참조한다.

## 소스별 경계

| 자산 | 허용 범위 | 라이선스/고지 | 추가 pin 요구 | 금지 |
| --- | --- | --- | --- | --- |
| 한국어기초사전 | 텍스트 표제어·발음·품사·뜻풀이·용례 | 국립국어원 출처, CC BY-SA 계열 고지, 변경·동일조건 배포 | 공식 download revision + archive SHA-256 | 이미지·음성 등 멀티미디어를 텍스트 조건으로 간주해 가져오기 |
| `elzup/jlpt-word-list` | 표제어·읽기·영어 뜻·태그 | MIT 원저작권·허가 고지 유지 | upstream commit SHA + 가져온 파일 SHA-256 | 공식 JLPT 목록·공식 제휴라고 표시하기, `master`만 pin으로 사용하기 |
| vocab-swipe JLPT 한국어 보강 | 한국어 뜻·자체 예문·번역·학습 팁 | Seorilabs 자체 생성 성분으로 분리 | vocab-swipe commit + 생성 recipe/input digest | MIT 원본 성분과 자체 생성 성분을 하나의 외부 라이선스로 뭉개기, 사람 검수 없이 배포하기 |
| TOEIC Service List / TSL | 목록·빈도·TSL 정의 중 허용 성분 | CC BY-SA 4.0 출처·변경·동일조건 고지 | Hugging Face dataset commit/revision + TSL 파일 SHA-256 | ETS 공식 문항·보기·해설·예문·음원 사용, 공식 제휴 오인 |
| WordNet 3.0 | 품사·정의·예문 중 WordNet 출처 성분 | WordNet 3.0 license와 attribution | WordNet 3.0 archive SHA-256 | 자체 작성 예문을 WordNet 출처로 표시하거나 그 반대로 표시하기 |
| vocab-swipe TOEIC 자체 보강 | 한국어 gloss·자체 예문·번역 | Seorilabs 자체 작성 성분으로 분리 | vocab-swipe commit + enrichment revision/input digest | 외부 CC BY-SA/WordNet 성분의 고지를 제거하기 |

현재 snapshot의 JLPT generated 헤더는 `elzup/jlpt-word-list@master`, TOEIC generated 헤더는 합성 revision 문자열을 쓴다. **현재 bytes는 vocab-swipe commit으로 재현 가능하지만, 향후 upstream 재수집 전에는 upstream commit과 다운로드 파일 SHA-256을 별도로 채워야 한다.** 이 요건을 만족하지 않으면 기존 snapshot을 그대로 쓰거나 import를 중단한다.

## Card 매핑

| vocab-swipe | generic Card | 비고 |
| --- | --- | --- |
| `word` | `front` | 표제어 |
| `meaning` | `back` | 뜻·핵심 설명 |
| `reading` | `reading` | optional |
| `example` | `example` | 출처 성분을 구분 |
| `exampleMeaning` | `exampleMeaning` | 자체 번역 여부 기록 |
| `studyTip` | `hint` | optional |
| source id / generated header | `sourceRefs[]` + deck `source` | revision/commit pin 필수 |

가져온 뒤 원천 순서를 그대로 신뢰하지 않는다. generic Card로 normalize하고, 동일 front/back 제거, 동일 front/다른 back 충돌 해소, safety/copyright/factual QA, 사람 승인을 차례로 수행한다.

## P1 결정적 선별 계획

| 덱 | 선별 기준 | 결과 수 | 중복 경계 |
| --- | --- | ---: | --- |
| `english-essential-intro` | TOEIC 원본의 연속 rank `1..600` | 600 | 심화 덱의 첫 600장과 의도적으로 겹치며 `deckId`가 달라 카드 ID는 분리 |
| `english-toeic-advanced` | TOEIC 원본의 연속 rank `1..1250` | 1,250 | rank와 표제어가 모두 고유해야 함 |
| `japanese-jlpt-n5-preview` | N5 원본 순회 → 레벨 내 첫 표제어 유지 → 한국어 enrichment 교집합 → 첫 240장 | 240 | 첫 카드 `会う`, 240번째 `石鹸` |
| `japanese-jlpt-n3-n2` | N3 전체 1,462장 뒤 N2 전체 1,227장을 연결하고 표제어 첫 항목 유지 | 2,688 | 교집합은 `故郷` 1건뿐이며 N3 카드를 유지 |

영어는 `front=word`, `back=한국어 gloss`, `example=자체 보강 우선/원본 fallback`, `exampleMeaning=자체 번역`, `hint=최종 예문 출처별 고지`, `difficulty=min(5, ceil(rank/250))`로 변환한다. JLPT는 `front=word`, `back=meaningKo`, `reading`, `example`, `exampleMeaning`, `hint=studyTip 또는 고정 기본 문구`, 레벨별 `difficulty` N5=1/N3=3/N2=4로 변환한다.

## 실행과 산출물

repo root에서 sibling source checkout을 명시해 4개 draft를 만든다.

```bash
pnpm --dir content-pipeline run import:vocab-swipe -- \
  --source-repo /absolute/path/to/vocab-swipe
```

기본 호환 산출물은 `content-pipeline/.work/<deck-id>.json`이다. 같은 manifest와 snapshot에서는 카드, ID, input digest가 동일하다. `workflow.history.at`은 provenance를 위조하지 않도록 실제 import 실행 시각을 기록하며, 원본 commit 시각은 `sourceRegistry`에만 둔다. 이 명령은 QA를 수행하지만 사람 승인 정보를 만들지 않으며 네 record 모두 `awaiting-human-approval`, reviewer `pending`에서 멈춘다.

## 배포 체크

1. 외부 `source.commit`이 40자리 SHA이고 `source.revision`이 비어 있지 않다.
2. 모든 라이선스 성분에 `id`, `attribution`, `evidenceUri`, 상업 이용 확인, ShareAlike 여부가 있다.
3. ShareAlike 성분이 있으면 `distributionNotice`와 실제 앱/배포물 attribution에 동일조건 고지가 있다.
4. 카드의 `sourceRefs`가 revision 고정된 registry 항목을 가리킨다.
5. 교재·기출·강의 원문의 장문 복제 의심 항목이 없다.
6. 사람 검수자의 이름·시각·근거가 기록되기 전에는 `approved`, `chunked`, `published`로 전이하지 않는다.
