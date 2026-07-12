# Release Checklist

## Planning Gate

- [ ] Planning approval 완료
- [ ] Product spec 확정
- [ ] Package name / bundle ID / AppsInToss appName 확정
- [ ] Firebase project strategy 확정

## Architecture Gate

- [ ] `pnpm run test:core`
- [ ] `pnpm run check:architecture`
- [ ] platform SDK가 core에 import되지 않음

## Market Gate

- [ ] Google Play metadata와 config 확정
- [ ] App Store metadata와 config 확정
- [ ] AppsInToss metadata와 config 확정
- [ ] Firebase rules/indexes/functions 확정
- [ ] Privacy/data safety/review notes 확정

## QA Gate

- [ ] Android smoke
- [ ] iOS smoke
- [ ] Android/iOS cold-start에서 제품 브랜딩 스플래시만 노출됨
- [ ] React Native/프레임워크 기본 런치 화면 문구가 노출되지 않음
- [ ] AppsInToss sandbox smoke
- [ ] Offline/local-first smoke
- [ ] Analytics/crash/ad/purchase smoke, 해당 시

## Deployment Gate

- [ ] Deployment approval 완료
- [ ] Google Play production 또는 testing track 배포 승인
- [ ] App Store TestFlight 또는 App Review 제출 승인
- [ ] AppsInToss production release 승인
