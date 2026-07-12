# AppsInToss Target

AppsInToss Granite React Native target 자리다.

## 선택한 방향

- Granite React Native
- TDS React Native 필수
- AppsInToss runtime API는 adapter로 격리
- normal React Native native module이 Toss runtime에서 동작한다고 가정하지 않는다.

## 초기화

```bash
pnpm run bootstrap:ait -- <app-name>
pnpm --dir apps/ait add @apps-in-toss/framework @toss/tds-react-native
pnpm --dir apps/ait ait init --template react-native --app-name <app-name>
```

초기화 후 확인할 것:

- `apps/ait/granite.config.ts`
- `apps/ait/src/_app.tsx`
- `TDSProvider`
- AppsInToss `Storage` adapter
- route와 sandbox scheme

## Release

- `.ait` 파일은 커밋하지 않는다.
- `.ait` build 성공은 console 등록, 이미지, 광고, sandbox QA 완료를 의미하지 않는다.
