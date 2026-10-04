# ツクリドキ！

本が作りたくなる、同人誌印刷所フェアまとめサイト  
https://tsukuridoki.sasadokoro.online/

## コマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発用サーバーを起動 |
| `npm run validate` | データ検証（`data/` を `schemas/` のルールで確認） |
| `npm test` | 時期判定ロジックのテスト |
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
| `src/lib/period.ts` | 時期判定ロジック |

## データのルール

- ファイル名は `{ID}.yaml`
- 日付は `YYYY-MM-DD`
- 書いていない項目は「不明」として扱う

## ブランチ

- `main`：公開用。直接pushしない。マージ＝公開
- `develop`：開発用
- 自動公開：main 更新時と毎日4:30（日本時間）
