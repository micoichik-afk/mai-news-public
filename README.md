# マイ・ニュース公開版

AI / ゴルフ / ボウリング / キャンプ / Apple製品 / ボートレース の日本語ニュースを集めて、
スマホで読みやすく表示する公開ページです。誰でも URL を開くだけで使えます。

- カテゴリタブ（6カテゴリ）と「今日の注目」（各カテゴリの最新1件）
- キーワード検索
- 記事カード = 日本語の見出し + 短い要約 + 出典 + 日付（タップで元記事へ）
- 著作権配慮のため、記事本文は扱わず見出し・要約・リンクのみ掲載します
- **毎日 07:00（日本時間）に GitHub Actions が自動でニュースを取り直して更新します**

## 仕組み

| ファイル | 役割 |
|---|---|
| `fetch_news.py` | 公開RSS（主: Bing News RSS 日本語版／予備: Google News RSS）から記事を取得し `docs/articles.json` を生成（Python標準ライブラリのみ） |
| `docs/` | GitHub Pages で公開する静的サイト一式（`index.html` / `style.css` / `app.js` / PWA設定） |
| `.github/workflows/update.yml` | 毎日 07:00 JST に `fetch_news.py` を実行し、変化があれば自動コミットするワークフロー |

## デプロイ手順（GitHub Pages）

所要時間の目安: 10分ほど。GitHub アカウントが1つ必要です。

### 1. リポジトリを作ってこのプロジェクトを push する

```bash
# GitHub で空のリポジトリ（例: mai-news-public）を作成してから
cd mai-news-public
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<あなたのユーザー名>/mai-news-public.git
git push -u origin main
```

### 2. Actions の書き込み権限を確認する

リポジトリの **Settings → Actions → General → Workflow permissions** で
**「Read and write permissions」** を選んで Save。
（これが無いと、毎日の自動更新コミットが失敗します）

### 3. GitHub Pages を有効化する

リポジトリの **Settings → Pages** で：

- **Build and deployment → Source**: `Deploy from a branch`
- **Branch**: `main` / フォルダ: `/docs` を選んで Save

数分待つと、ページの URL が表示されます：

```
https://<あなたのユーザー名>.github.io/mai-news-public/
```

### 4. 最初のニュース生成を実行する

リポジトリの **Actions** タブ → **Daily News Update** → **Run workflow** を1回押す。
成功すると `docs/articles.json` が最新の記事で更新され、ページに記事が並びます。
（このプロジェクトには生成済みの `articles.json` が含まれているので、待たずにそのまま公開しても記事は表示されます）

## 毎日の自動更新について

- ワークフローは UTC 22:00 = **日本時間 07:00** に毎日動きます
- `fetch_news.py` が各カテゴリ最新8件までを取得・重複除去し、`articles.json` を再生成します
- 変化があったときだけ `github-actions[bot]` がコミットし、GitHub Pages に自動で反映されます
- 失敗したフィードがあっても、予備フィード（Google News RSS）で補完し、取れた分だけで更新します
- 実行履歴は **Actions** タブで確認できます

## スマホのホーム画面に追加する（アプリのように使う）

公開 URL をスマホで開いてから：

- **iPhone（Safari）**: 下部の共有ボタン →「ホーム画面に追加」→ 追加
- **Android（Chrome）**: 右上の ⋮ メニュー →「ホーム画面に追加」または「アプリをインストール」

アイコンから直接開けるようになり、全画面のアプリ風表示になります。

## カテゴリや検索ワードを変えたいとき

`fetch_news.py` の先頭にある `CATEGORIES` を編集して push すれば、
次の自動更新（または Actions の手動実行）から反映されます。

## 注意・制限

- 記事の取得は公開RSSフィードの配信状況に依存します。フィード側の仕様変更や障害時は、そのカテゴリの件数が減ったり古いままになることがあります
- 要約は RSS に含まれる紹介文（スニペット）をもとに整形したものです
- Google News RSS を予備として使うカテゴリでは、要約が付かない記事があります
- GitHub Pages の無料枠／Actions の無料実行枠の範囲内で動作する想定です
