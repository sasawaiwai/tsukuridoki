# ツクリドキ！

本が作りたくなる、同人誌印刷所フェアまとめサイト  
https://tsukuridoki.sasadokoro.online/

## コマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発用サーバーを起動 |
| `npm run validate` | データ検証（`data/` を `schemas/` のルールで確認） |
| `npm test` | 時期判定・カード表示・絞り込みのテスト |
| `npm run build` | データ検証 → サイト生成（`dist/`） |
| `npm run preview` | 生成したサイトを確認 |

## ディレクトリ

| 場所 | 内容 |
|---|---|
| `data/fairs/` | フェア（1フェア1ファイル。終了後も同じ場所に置く） |
| `data/printers/` | 印刷所マスター |
| `data/papers/`・`data/foils/` | 用紙・箔マスター |
| `data/processes/`・`data/tags/` | 加工マスター・自由タグ |
| `schemas/` | データのルール（JSON Schema） |
| `src/lib/period.ts` | 時期判定ロジック（状態ラベルの優先順位を含む） |
| `src/lib/fair-display.ts` | フェアカードの表示データ（色・特典文・チップ・期限・確認日） |
| `src/lib/lists.ts` | 一覧ページの定義（時期別・属性別・アーカイブ） |
| `src/lib/search.ts` | 絞り込みの条件（属性別ページと検索ページで共用。カードの見た目とは分離） |
| `src/lib/site.ts` | サイト設定（運営者表記・お問い合わせフォームのURL・noindex） |
| `src/lib/nav.ts` | ナビゲーションのリンク先 |
| `src/styles/global.css` | デザイントークン（色・文字・余白・角丸） |
| `src/components/` | 共通部品（ヘッダー・フッター・フェアカード・ラベル・チップ・ボタンなど） |

## デザインシステム

画面はすべて `src/components/` の共通部品と `src/styles/global.css` のトークンで作る。新しい見た目を個別に作らない。部品の一覧は `/dev/styleguide/` で確認できる。

## 確認用ページ（/dev/）

- `/dev/styleguide/`：共通部品の一覧
- `/dev/check/`：時期判定の確認表

`/dev/` 以下は正式公開後も検索エンジンに載せない（noindex・sitemap.xml から除外）。

## 正式公開（noindex解除）の前にやること

- `data/` の架空サンプル（印刷所名に「（架空）」）をすべて削除する
- `src/lib/site.ts` の `noindex` を `false` にし、`public/robots.txt` を書き換えて sitemap.xml の場所を書く

## データのルール

- ファイル名は `{ID}.yaml`
- 日付は `YYYY-MM-DD`
- 書いていない項目は「不明」として扱う
- 公式情報源は `sources` にURLを並べるだけ（最低1件）。公式サイト・X・Instagram・Blueskyなどの種類はURLから自動で判定する

```yaml
sources:
  - https://example.com/fair/autumn/       # 公式サイト
  - https://x.com/example/status/123456   # 公式Xの告知投稿（何件でも）
```

## ブランチ

- `main`：公開用。直接pushしない。マージ＝公開
- `develop`：開発用
- 自動公開：main 更新時と毎日2:17（日本時間）
