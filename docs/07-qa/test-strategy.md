# Test Strategy

## Layer

| Layer | 목적 | 명령/위치 |
| --- | --- | --- |
| Core unit | domain/use case 순수 로직 | `pnpm run test:core` |
| Architecture | core import boundary | `pnpm run check:architecture` |
| Docs | docs source-of-truth 구조 | `pnpm run check:docs` |
| Mobile target | RN Android/iOS target 초기화 | `pnpm run check:mobile` |
| AIT target | Granite RN target 초기화 | `pnpm run check:ait` |
| Release inventory | market/release blocker | `pnpm run check:release` |

## Device QA

- Android device/emulator: `확정 필요`
- iOS simulator/device: `확정 필요`
- AppsInToss sandbox device: `확정 필요`

## Regression Rules

- core 변경은 device 없이 검증 가능한 테스트를 먼저 추가한다.
- adapter 변경은 target-specific smoke를 추가한다.
- market policy나 SDK 데이터 수집 변경은 `docs/05-markets/`와 privacy/data safety 문서를 함께 갱신한다.
- native startup 변경은 cold start를 확인한다. iOS `LaunchScreen`과 Android splash/launch theme에서 React Native 또는 framework template 문구가 보이면 release blocker다.
