# シフト手帳

シフト入力・給料計算・予定・共有(LINEに貼れる文章、希望シフト提出、.ics)・祝日・曜日まとめ入力・先月コピー・年収の壁。

バイトのシフト管理と給料計算のAndroidアプリ(Capacitor製)。

## 使い方(開発)
- `www/` がアプリ本体。ブラウザで `www/index.html` を開けばそのまま動く。
- APKはGitHubにpushすると Actions が自動で作る(Actions → 最新の実行 → Artifacts → shift-techo-apk)。
- ローカルで作る場合: JDK 17以上 + Android SDK を入れて `npx cap sync android && cd android && ./gradlew assembleDebug`。

## グループ共有(Firebase)の設定
1. https://console.firebase.google.com でプロジェクトを作成
2. 「ウェブアプリを追加」→ firebaseConfig をコピーし、アプリの「みんな」タブに貼り付け
3. Authentication → Sign-in method → 「匿名」を有効化
4. Firestore Database を作成し、ルールを以下に置き換え

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /groups/{code} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      match /members/{uid} {
        allow read: if request.auth != null;
        allow write: if request.auth != null && request.auth.uid == uid;
      }
    }
  }
}
```
