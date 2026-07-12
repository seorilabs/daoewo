# Product Core

`@daoewo/product-core`는 다외워의 platform 독립 제품 로직이다.

허용:

- domain entities
- value objects
- pure use cases
- port interfaces
- pure fixtures/fakes

금지:

- React Native / Expo / native module import
- Firebase / AppsInToss / Toss SDK import
- Google Play / App Store SDK import
- network client 직접 호출

## 폴더

```text
src/domain/      # entities, value objects
src/use_cases/   # application use cases
src/ports/       # platform contracts
tests/           # pure tests and fakes
```

## 공개 기능

- `Deck`, generic `Card<TMedia>`, `StudyGoal`, `CardProgress`, `ReviewQueueItem`
- 목표 기간/일일 카드 수 배분과 KST-safe date key
- known/unknown swipe 분류와 easy/confused/missed 고정 SRS
- due review queue, 달력 통계, 완료일 스트릭
- Free/Pro entitlement와 덱/일일 학습 한도
- Pro 잠금 상태를 포함한 catalog metadata 필터
- deck request 정규화와 validation

```bash
pnpm --filter @daoewo/product-core run check
```
