# Markets

마켓별 등록/심사/릴리스 원장을 관리한다.

- `google-play.md`
- `app-store.md`
- `apps-in-toss.md`
- `firebase.md`
- `privacy-data-inventory.md`
- `subscription-terms.md`
- `third-party-content-notices.md`

`pnpm run check:release`는 machine config와 runtime config, 실제 screenshot/content/build
inventory를 함께 검사한다. 빈 URL·상품 ID·Firebase 식별자는 의도된 release blocker다.
