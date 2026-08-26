# 제3자 콘텐츠 고지 원장

이 문서는 `content-pipeline/manifests/v1.json`의 라이선스 정보를 사람이 읽을 수
있게 정리한 배포 원장이다. 현재 모든 v1 콘텐츠는 계획 또는 사람 승인 대기 상태이며,
승인되지 않은 카드 본문은 앱·Firebase·스토어 산출물에 포함하지 않는다.

## 현재 콘텐츠 Inventory (2026-08-26)

- 카탈로그 메타: 14덱(Free 6 / Pro 8), 모두 `coming-soon`
- 로컬 vocab-swipe import P1 draft: 2개
  - `english-essential-intro`(Free): 300장, `awaiting-human-approval`
  - `english-toeic-advanced`(Pro): 950장, `awaiting-human-approval`
  - provider `vocab-swipe-import-v1`, vocab-swipe commit
    `e1ba2d5503d1f90ee9d6995c80070b0e2e3152e6` 고정
- 운영자 batch draft: 7개, 각 200장, 모두 `awaiting-human-approval`
  - `korean-history-cert-core`, `information-processing-engineer`,
    `it-cs-interview-terms`, `high-school-korean-history-timeline`(이상 Pro),
    `business-english-expressions`, `wine-basics`(Pro),
    `middle-school-essential-english`(Free)
  - provider `claude-operator-batch-v1`. batch 원본은
    `content-pipeline/batches/*.raw.json`으로 커밋되어 검수자가 diff로 읽을 수 있다.
  - 기존 Gemini P1 draft 2개(각 20장)는 같은 덱의 batch 200장 초안으로 대체됐다.
- 미작성 유지: `driving-license-key-points`, `world-capitals-flags` —
  현행 법령·공식 국가 정보 revision 고정이 선행돼야 하므로 `planned`로 남긴다.
  vocab-swipe import 대상인 `japanese-jlpt-n5-preview`, `japanese-jlpt-n3-n2`,
  `korean-vocabulary`는 importer 확장 대기.
- 사람 승인·publication: 0개
- production published body: **0개** (`PUBLISHED_DECK_CONTENT = {}`)

vocab-swipe import 결과물(`content-pipeline/.work/`)은 gitignored 작업물이고, batch
초안은 저장소에 커밋된 검수 대기 문서다. 어느 쪽이든 자동 안전/저작권/사실 QA를
통과했어도 사람 검수 증거가 없으므로 앱 bundle, Firebase, store screenshot에 사용할
수 없다. `check:release`는 로컬 draft 수를 참고 출력하고, published body가 0이면
반드시 실패한다.

`english-essential-intro`는 Free라 승인되면 본문이 client bundle로 들어간다. 이 덱은
CC BY-SA 4.0 성분(TSL 표제어·정의)을 포함하므로 **발행 전에 앱에서 접근 가능한 저작자
표시·동일조건 고지 화면이 필요하다.** 현재 `PUBLIC_CATALOG`의 `license.attributions`와
`distributionNotice`가 클라이언트까지 전달되지만 이를 렌더링하는 UI는 아직 없다.

## 한국어기초사전

- 제공자: 국립국어원
- 출처: https://krdict.korean.go.kr
- 대상: 텍스트 표제어·발음·품사·뜻풀이·용례
- 조건: 출처와 변경 사실을 표시하고 동일조건 공유 조건을 유지한다.
- 제외: 이미지·영상·음악·음성 등 멀티미디어는 별도 권리 확인 전 포함하지 않는다.

## elzup/jlpt-word-list

- 출처: https://github.com/elzup/jlpt-word-list
- 라이선스: MIT
- 대상: JLPT N1~N5 표제어·읽기·영어 뜻·태그
- 조건: upstream commit과 가져온 파일 digest를 고정하고 원저작권·허가 고지를
  배포물에 포함한다.
- 자체 보강: 한국어 뜻·예문·번역·학습 팁은 별도 provenance로 관리하며 사람 승인
  전 공개하지 않는다. 공식 JLPT 목록이나 제휴로 표시하지 않는다.

## TOEIC Service List 1.2

- 배포 출처: https://huggingface.co/datasets/nltk-data-hub/words
- 원목록: TOEIC Service List 1.2, Browne and Culligan
- 라이선스: CC BY-SA 4.0
- 조건: 출처·변경·동일조건 공유 고지를 유지하고 실제 배포 revision과 파일 digest를
  고정한다.
- 제외: ETS 공식 문항·보기·해설·예문·화면·음원은 포함하지 않으며 공식 제휴로
  오인시키지 않는다.
- 현재 import 범위: `english-essential-intro`(rank 1~300)와
  `english-toeic-advanced`(rank 301~1250)의 표제어. rank 1~300은 TSL 1.2 정의도
  카드 `hint`로 사용한다.
- 고정 pin: vocab-swipe commit `e1ba2d55`, 생성 헤더 revision
  `nltk-data-hub/words@toeic+tsl-definitions+wordnet-3.0-top-300`, 세 자산 파일의
  SHA-256을 work record `sourceRegistry`에 기록한다. upstream 재수집 시에는 별도
  dataset commit과 다운로드 파일 SHA-256을 새로 확보해야 한다.

## WordNet 3.0

- 출처: https://wordnet.princeton.edu/
- 라이선스: WordNet 3.0 license
- 대상: TOEIC 상위 일부 카드의 품사 후보와 표제어를 포함한 예문
- 조건: 실제 사용 범위와 원문 라이선스를 배포 고지에 유지한다.
- 현재 사용량: `english-essential-intro` 300장 중 59장의 예문. 자체 예문이 덮어쓴
  카드는 WordNet 성분으로 표시하지 않는다. `english-toeic-advanced`는 WordNet 예문을
  쓰지 않는다.

## 출시 전 확인

- 외부 source commit/revision과 archive SHA-256 확정
- MIT 원저작권 문구와 각 라이선스 원문 보관
- ShareAlike 대상 카드와 자체 작성 성분의 provenance 분리
- 카드 사실·안전·저작권 검수자, 시각, 근거 기록
- 앱 설정/스토어 설명에서 접근 가능한 최종 고지 URL 확정
