# シフト手帳

バイトのシフト管理と給料計算のAndroidアプリ(Capacitor製)。

## 使い方(開発)
- `www/` がアプリ本体。ブラウザで `www/index.html` を開けばそのまま動く。
- APKはGitHubにpushすると Actions が自動で作る(Actions → 最新の実行 → Artifacts → shift-techo-apk)。
- ローカルで作る場合: JDK 17以上 + Android SDK を入れて `npx cap sync android && cd android && ./gradlew assembleDebug`。
