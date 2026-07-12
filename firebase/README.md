# Firebase

Firebase rules, indexes, functions, emulator config를 둔다.

Firebase가 필요 없는 local-only MVP라면 adapter와 SDK를 추가하지 않는다.

## 기본 파일

- `firestore.rules`
- `firestore.indexes.json`
- `storage.rules`
- `firebase.json`
- `.firebaserc.example`

## 금지

- service account JSON commit
- private key commit
- Admin SDK credential client app 포함
