# Offline P1 fixtures

네트워크와 유료 API 없이 생성→정규화→중복제거→3종 QA→사람 승인 대기 흐름을 검증하는 작은 입력이다.

- `korean-history-cert-core.raw.json`: P1 한국사 5장.
- `it-cs-interview-terms.raw.json`: P1 IT/CS 5장 + 중복제거를 검증하는 입력 1장.

두 fixture의 source registry는 파이프라인 동작 검증용 `urn:`이다. 실제 출시용 사실 근거가 아니며 `fixtureOnly: true`로 표시된다. smoke는 `awaiting-human-approval`에서 멈추며 fixture를 정식 콘텐츠로 배포하지 않는다.
