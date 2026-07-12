# CI/CD 워크플로우 (org 표준)

이 템플릿의 `.github/workflows/*`는 모두 org 재사용 워크플로우(`seorilabs/.github`)를 호출하는 **얇은 caller**다. 전체 설계는 `seorilabs/.github`의 `docs/ci-cd/org-cicd-release-system.md` 참조.

## 워크플로우

| 파일 | 트리거 | 역할 | 러너 |
|---|---|---|---|
| `static-checks.yml` | push/PR→main, dispatch | 정적 게이트(`pnpm run test`) | ARC(private)/ubuntu |
| `release-tag.yml` | dispatch | 명시적 SemVer 태그 | ARC |
| `deploy-apps-in-toss.yml` | dispatch, call | .ait build + AppsInToss | ARC |
| `deploy-google-play.yml` | dispatch, call | 서명 AAB + Google Play | ubuntu |
| `deploy-app-store.yml` | dispatch, call | Xcode archive + App Store | macos-26 |
| `deploy-all.yml` | dispatch | 태그 1개로 3마켓 한 번에 | — |
| `cleanup-actions-storage.yml` | dispatch | 아티팩트/캐시 정리 | ARC |
| `release-inventory.yml` | dispatch | 릴리즈 준비 점검 | — |

- **main = 정적 게이트만.** 마켓 업로드는 명시적 Release/Tag 후 dispatch(보통 Backoffice/Telegram).
- 아티팩트 retention = 3.

## 앱별로 채워야 하는 것 (contract)

1. **`deploy-app-store.yml`의 `ios_scheme`/`ios_workspace`/`ios_bundle_id`** 를 실제 값으로 교체.
2. 표준 스크립트:
   - `scripts/resolve-release-version.mjs --tag <tag> --github-output` → `version_name`, `android_version_code`, `apple_marketing_version`, `apple_build_number`, `release_name`
   - `scripts/upload-google-play-internal.py` (Android Publisher API 업로드)
   - `scripts/restore-mobile-firebase-config.mjs --android|--ios --require`
   - Android: `apps/mobile/android/gradlew :app:bundleRelease -PversionNameOverride -PversionCodeOverride`
3. **secrets/variables**: org 공통(`APPS_IN_TOSS_API_KEY`, `APPLE_*`, `APP_STORE_CONNECT_*`, `GOOGLE_PLAY_UPLOAD_*`, var `APPLE_TEAM_ID`/`GOOGLE_PLAY_UPLOAD_KEY_ALIAS`/`GOOGLE_WORKLOAD_IDENTITY_PROVIDER`)는 상속. **repo 레벨**: `APPLE_PROVISIONING_PROFILE_BASE64`, `FIREBASE_ANDROID_GOOGLE_SERVICES_JSON_BASE64`, `FIREBASE_IOS_GOOGLE_SERVICE_INFO_PLIST_BASE64`, var `GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL`.
4. **GitHub Environments**: `apps-in-toss`, `google-play`, `app-store` 생성(보호 규칙 권장).

## @ref 핀

caller의 `uses: seorilabs/.github/.github/workflows/*.yml@main` — 안정화 후 태그/SHA 핀 권장.
