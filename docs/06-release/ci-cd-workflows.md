# CI/CD 워크플로우 (org 표준)

이 템플릿의 `.github/workflows/*`는 모두 org 재사용 워크플로우(`seorilabs/.github`)를 호출하는 **얇은 caller**다. 전체 설계는 `seorilabs/.github`의 `docs/ci-cd/org-cicd-release-system.md` 참조.

## 워크플로우

| 파일 | 트리거 | 역할 | 러너 |
|---|---|---|---|
| `static-checks.yml` | push/PR→main, dispatch | 정적 게이트(`lint` + `typecheck` + test/assets), Firebase Rules 별도 | ARC(private) + ubuntu(Java 21) |
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
   - 버전은 저장소가 계산하지 않는다. stable SemVer 태그(`vX.Y.Z`)가 유일한 authority이고 org 재사용 워크플로우가 `version_name`, `android_version_code`, `apple_marketing_version`, `apple_build_number`, `release_name`을 파생해 빌드에 주입한다.
   - `scripts/upload-google-play-internal.py` (Android Publisher API 업로드)
   - `scripts/restore-mobile-firebase-config.mjs --android|--ios --require`
   - Android: `apps/mobile/android/gradlew :app:bundleRelease -PversionNameOverride -PversionCodeOverride`
3. **secrets/variables**: org 공통(`APPS_IN_TOSS_API_KEY`, `APPLE_*`, `APP_STORE_CONNECT_*`, `GOOGLE_PLAY_UPLOAD_*`, var `APPLE_TEAM_ID`/`GOOGLE_PLAY_UPLOAD_KEY_ALIAS`/`GOOGLE_WORKLOAD_IDENTITY_PROVIDER`)는 상속. **repo secrets**: `APPLE_PROVISIONING_PROFILE_BASE64`, `FIREBASE_ANDROID_GOOGLE_SERVICES_JSON_BASE64`, `FIREBASE_IOS_GOOGLE_SERVICE_INFO_PLIST_BASE64`, `APP_STORE_IAP_PRIVATE_KEY_BASE64`, `APP_STORE_ROOT_CA_CERTIFICATES_BASE64_JSON`. **repo variables**: `FIREBASE_PROJECT_ID`, `FUNCTIONS_REGION`, `GOOGLE_PLAY_PRODUCT_IDS`, `GOOGLE_PLAY_RTDN_TOPIC`, `APP_STORE_APP_APPLE_ID`, `APP_STORE_PRODUCT_IDS`, `APP_STORE_IAP_ISSUER_ID`, `APP_STORE_IAP_KEY_ID`, `TOSS_FIREBASE_APP_ID`, `GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL`.
4. **GitHub Environments**: `apps-in-toss`, `google-play`, `app-store` 생성(보호 규칙 권장).

`Release Inventory`는 Firebase 공개 native config만 임시 파일로 복원한다. App Store IAP private
key와 root certificate 값은 checker process에 주입하지 않고 GitHub expression이 계산한
`*_CONFIGURED=true|false` marker만 전달한다. 따라서 외부 설정을 완료하면 CI에서도 green이 될
수 있고, 값이 비어 있으면 raw secret 노출 없이 fail-closed한다.

## @ref 핀

caller의 `uses: seorilabs/.github/.github/workflows/*.yml`는 immutable commit SHA로 고정한다.
현재 핀은 `@9afa357f9ba6c8d6a813c7cec7ad3d35c626bdd5`이다. `@main` 같은 floating ref는 release binding의 config revision을 고정할 수
없어 org 계약(`release-version-authority-v1`)에서 즉시 결함으로 본다.
