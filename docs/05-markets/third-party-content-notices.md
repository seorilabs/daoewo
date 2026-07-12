# 제3자 콘텐츠 고지 원장

이 문서는 `content-pipeline/manifests/v1.json`의 라이선스 정보를 사람이 읽을 수
있게 정리한 배포 원장이다. 현재 모든 v1 콘텐츠는 계획 또는 사람 승인 대기 상태이며,
승인되지 않은 카드 본문은 앱·Firebase·스토어 산출물에 포함하지 않는다.

## 현재 콘텐츠 Inventory (2026-07-12)

- 카탈로그 메타: 14덱(Free 6 / Pro 8), 모두 `coming-soon`
- 로컬 Gemini P1 draft: 2개, 각 20장
  - `information-processing-engineer`: `awaiting-human-approval`
  - `korean-history-cert-core`: `awaiting-human-approval`
- 두 work record의 provider: `gemini-operator-batch-v1`
- 사람 승인·publication: 0개
- production published body: **0개** (`PUBLISHED_DECK_CONTENT = {}`)

두 draft는 gitignored `content-pipeline/.work/`의 operator 작업물이다. 자동
안전/저작권/사실 QA를 통과했어도 사람 검수 증거가 없으므로 앱 bundle, Firebase,
store screenshot에 사용할 수 없다. `check:release`는 로컬 draft 수를 참고 출력하고,
published body가 0이면 반드시 실패한다.

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

## WordNet 3.0

- 출처: https://wordnet.princeton.edu/
- 라이선스: WordNet 3.0 license
- 대상: TOEIC 상위 일부 카드의 품사 후보와 표제어를 포함한 예문
- 조건: 실제 사용 범위와 원문 라이선스를 배포 고지에 유지한다.

## 출시 전 확인

- 외부 source commit/revision과 archive SHA-256 확정
- MIT 원저작권 문구와 각 라이선스 원문 보관
- ShareAlike 대상 카드와 자체 작성 성분의 provenance 분리
- 카드 사실·안전·저작권 검수자, 시각, 근거 기록
- 앱 설정/스토어 설명에서 접근 가능한 최종 고지 URL 확정
