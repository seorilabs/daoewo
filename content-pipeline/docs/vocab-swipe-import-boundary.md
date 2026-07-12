# vocab-swipe 콘텐츠 import 경계

## 기준 snapshot

- 원천 repo: `https://github.com/seorilabs/vocab-swipe`
- 이 manifest가 확인한 commit: `e1ba2d5503d1f90ee9d6995c80070b0e2e3152e6`
- 가져올 수 있는 범위: 해당 commit의 generated 데이터와 자체 보강 데이터 중, 아래 라이선스 성분과 provenance를 카드 단위로 보존할 수 있는 항목.
- 가져오지 않는 범위: UI·앱 코드, 출처가 불명확한 데이터, 원천 revision이 움직이는 branch만 적힌 새 fetch 결과, 권리를 확인하지 않은 이미지·음성.

`source.commit`은 실제 bytes를 담은 vocab-swipe snapshot을 고정한다. `source.revision`은 그 snapshot 안 generated 파일이 기록한 원천 revision을 함께 남긴다. 새로 upstream을 fetch할 때는 branch(`main`, `master`, `latest`)만 기록하면 실패로 취급하고 아래 추가 pin을 확보해야 한다.

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

## 배포 체크

1. 외부 `source.commit`이 40자리 SHA이고 `source.revision`이 비어 있지 않다.
2. 모든 라이선스 성분에 `id`, `attribution`, `evidenceUri`, 상업 이용 확인, ShareAlike 여부가 있다.
3. ShareAlike 성분이 있으면 `distributionNotice`와 실제 앱/배포물 attribution에 동일조건 고지가 있다.
4. 카드의 `sourceRefs`가 revision 고정된 registry 항목을 가리킨다.
5. 교재·기출·강의 원문의 장문 복제 의심 항목이 없다.
6. 사람 검수자의 이름·시각·근거가 기록되기 전에는 `approved`, `chunked`, `published`로 전이하지 않는다.
