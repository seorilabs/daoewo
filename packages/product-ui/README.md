# 다외워 Product UI

`apps/mobile`과 `apps/ait`이 함께 사용하는 React Native 제품 UI다. 화면 이동은 패키지 안의 단순 상태 라우팅으로 동작하며, 플랫폼 SDK는 앱 target이 `DaoewoRuntime`으로 주입한다.

## 제공 화면

- 온보딩·소셜 로그인·게스트 시작
- 홈, 덱 상세·목표 설정
- 좌/우 스와이프 학습과 버튼 대체 조작
- 즉시 플립 복습, 오답노트
- 카탈로그 검색·분야·Free/Pro 필터, 잠금 메타
- 덱 요청, 통계, Pro 페이월, 설정

대표색은 `#4C6FFF`이며 시스템 다크 모드와 동적 글자 크기를 따른다. 모든 주요 조작에는 접근성 label, hint 또는 state를 제공한다.

## 앱 target 연결

```tsx
import {
  APPS_IN_TOSS_AUTH_OPTIONS,
  DaoewoApp,
  type DaoewoRuntime,
} from '@daoewo/product-ui';

const runtime: DaoewoRuntime = {
  analytics,
  storage,
  auth,
  purchase,
  tts,
  content,
  now: () => new Date(),
};

export default function App() {
  return <DaoewoApp runtime={runtime} />;
}

// AppsInToss target: runtime.auth.signIn('toss')가 공식 appLogin adapter를 호출한다.
export function AppsInTossApp() {
  return (
    <DaoewoApp
      authOptions={APPS_IN_TOSS_AUTH_OPTIONS}
      runtime={appsInTossRuntime}
    />
  );
}
```

`runtime`을 생략하면 네트워크, 기기 저장소, 결제 SDK를 호출하지 않는 `createDemoRuntime()`이 사용된다. 실제 결제 권한은 target adapter가 서버 검증 결과를 반환해야 한다.

- 가격·체험 문구는 optional `purchase.getOffers()`가 반환한 스토어 현지화 값만 표시한다. 미구성·빈 응답·오류이면 구매를 차단한다.
- 이용약관·개인정보 링크는 optional `externalLinks`에 유효한 HTTPS URL과 opener가 있을 때만 활성화한다.
- 학습 상태는 Firebase/Toss UID별 `daoewo:learning-state:v2:<uid>`에만 저장한다. 계정 구분이 없던 v1 key는 읽지 않고 시작·계정 전환 때 제거한다.
- 카드 progress와 완료 세션은 UID별로 저장하되 Pro 덱 카드 본문은 영속화하지 않는다. Free 덱 snapshot만 오답노트용으로 저장하며, 세션·즉시 복습이 끝나면 현재 window 본문을 메모리에서 해제한다.
- 설정 토글은 기기 공통 `storage`에 저장한다. 통계와 오답노트는 저장된 학습값과 core 통계·SRS 계산 결과만 사용한다.

`content`는 다음 서버 경계를 구현한다.

- `listCatalog`, `getDeck`: 카드 본문이 없는 승인 metadata
- `createGoal`: 서버 권위 목표·배분 생성
- `getCardWindow`: 오늘 배정분과 복습 도래분만 반환. Pro 덱 전체 본문 fetch 금지
- `commitProgressBatch`: 세션 결과 일괄 저장
- `submitDeckRequest`: 요청 본문을 backend에 전달하되 analytics에는 category·locale만 전달

catalog metadata의 `availability`는 `coming-soon | published`, `cardCount`는 `number | null`이다. `coming-soon` 또는 카드 수 미확정 덱은 “준비 중”으로 표시하며 숫자 `0`으로 치환하거나 목표·카드 window 요청을 시작하지 않는다.

앱 최초 미로그인 상태에서는 Auth/AppCheck가 필요한 catalog 호출을 시작하지 않는다. 로그인 또는 게스트 인증 성공 후 catalog를 다시 불러오며, adapter의 loading·empty·error는 제품 문구로 처리한다.

Analytics는 기획서의 `memo_*` 필수 이벤트 12개만 타입으로 허용한다. `trackDaoewoEvent`가 이벤트별 허용 파라미터만 adapter로 전달하므로 덱 요청의 자유 입력 `topic`, `note`나 사용자 UID를 보내지 않는다.

## 검증

```bash
pnpm --filter @daoewo/product-ui typecheck
pnpm --filter @daoewo/product-ui test
```
