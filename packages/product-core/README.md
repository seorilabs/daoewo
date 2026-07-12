# Product Core

platform 독립 제품 로직을 둔다.

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
