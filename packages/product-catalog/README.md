# @daoewo/product-catalog

`content-pipeline/manifests/v1.json`에서 deterministic하게 생성한 순수 TypeScript runtime catalog다.

- root export `@daoewo/product-catalog`: 14개 공개 metadata와 entitlement별 `locked` 계산만 제공한다.
- server-only export `@daoewo/product-catalog/published-content`: source manifest와 publication manifest가 모두 `published`, 사람 검수가 `approved`, 청크 checksum이 유효할 때만 본문을 제공한다.
- client-safe export `@daoewo/product-catalog/bundled-free-content`: 같은 검증을 통과한 publication 중 `tier=free` 본문만 생성하며, 계정별 로컬 목표·SRS due queue·일일 60장·활성 1덱 adapter를 제공한다.
- 현재 14덱은 모두 기획/미승인 상태이므로 metadata는 `coming-soon`, `cardCount: null`로 노출되고 production 본문 export는 빈 객체다.
- `fixtureOnly` 결과와 `awaiting-human-approval` 결과는 production export 대상이 아니다.

```bash
pnpm --filter @daoewo/product-catalog generate
pnpm --filter @daoewo/product-catalog check:generated
pnpm --filter @daoewo/product-catalog test
```

생성물은 시각이나 파일 순회 순서에 의존하지 않는다. P1→P2→P3, 같은 우선순위에서는 deck id byte order로 정렬하고 source manifest digest를 함께 내보낸다.

클라이언트는 root metadata와 `bundled-free-content`만 사용한다. 프리미엄 전체 본문 보호를 위해 `published-content` subpath를 mobile/AIT/Web bundle에서 import하면 안 된다. 생성기 테스트는 Free/Pro publication을 함께 넣어도 client-safe module에 Pro deck id와 앞·뒷면 문자열이 포함되지 않음을 검증한다.
