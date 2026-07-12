# Firebase

## Project Strategy

- Firebase project ID: `확정 필요`
- Shared project or app-specific project: `확정 필요`
- Region: `확정 필요`
- Billing plan: `확정 필요`

## Services

| Service | 사용 여부 | 비고 |
| --- | --- | --- |
| Auth | `확정 필요` | 계정/동기화 필요할 때만 |
| Firestore | `확정 필요` | 구조화된 동기화 데이터 |
| Storage | `확정 필요` | 사용자/제품 파일 |
| Cloud Functions / Run | `확정 필요` | privileged operation |
| Remote Config | `확정 필요` | 기능 flag/tuning |
| Analytics | `확정 필요` | privacy disclosure 필요 |
| Crashlytics | `확정 필요` | App Store privacy label 필요 |
| Performance | `확정 필요` | privacy disclosure 필요 |
| FCM | `확정 필요` | push permission/review note 필요 |
| App Check | `확정 필요` | AIT compatibility 별도 검증 |

## Rules

- Firestore rules: `firebase/firestore.rules`
- Firestore indexes: `firebase/firestore.indexes.json`
- Storage rules: `firebase/storage.rules`

## Security

- service account JSON과 private key는 client app에 포함하지 않는다.
- Firebase API key와 app ID는 식별자지만, release docs와 CI secret ownership은 분리해서 관리한다.
- 공유 Firebase project를 쓰면 `app_id`, path prefix, tenant field, custom claims 등으로 앱 경계를 명확히 한다.
