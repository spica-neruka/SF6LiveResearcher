# SF6 LIVE フロントエンド

スト6の配信中・配信予定・配信者を探す静的フロントエンドです。

## 起動とAPI

このフォルダーをHTTPサーバーで配信して `index.html` を開きます。ビルドは不要です。
APIの既定URLは `js/app.js` 内にあります。ローカル検証では、アプリの読み込み前に
`window.SF6_API_BASE` を設定することで検証用APIへ接続できます。

本番APIは許可されたサイトのOriginのみ受け付けます。ローカルで本番APIを使うために
本番のアクセス制限を変更する必要はありません。下記のブラウザ検証はAPIをモックします。

## 対応するバックエンド

隣接リポジトリ `../sf6-live-researcher` の変更と合わせて反映します。

- `GET /api/streamers?q=...`：配信者名・チャンネル名の部分一致検索。
- 一覧の `hasNextPage` / `nextCursor`：総件数に依存しない追加読み込み。
- `GET /api/favorites?ids=...`：1回最大50チャンネル。配信中・予定・オフラインの情報を返します。

反映時はバックエンドを先に更新し、その後フロントエンドを公開してください。
今回のAPI追加にDBマイグレーションは不要です。既存バックエンドの前提となる
マイグレーションについては、バックエンド側READMEに従ってください。

## ブラウザ検証

Node.jsとPlaywrightが必要です。通常は次を実行します。

```sh
node scripts/verify-frontend.mjs
```

Playwrightを別の場所から利用する場合は `UI_PLAYWRIGHT_PATH` に `playwright/index.mjs` の
絶対パスを指定します。必要に応じて `UI_CHROMIUM_PATH` にChrome/Chromiumの実行ファイル、
`UI_OUTPUT_DIR` にスクリーンショットの保存先を指定できます。

検証は本番API・YouTubeへ接続せず、ローカルのソースと固定のAPI応答で行います。
