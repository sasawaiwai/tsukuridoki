// サイト全体の設定

export const SITE = {
  name: 'ツクリドキ！',
  subtitle: '同人誌印刷所フェアまとめサイト',
  tagline: '本が作りたくなる、同人誌印刷所フェアまとめサイト',
  // 運営者の表記（運営者情報・フッター）
  operator: 'ササドコロ',
  cooperation: 'コトノミン',
  // お問い合わせ用のGoogleフォーム（仕様書35章）。作成したらURLを設定する。null の間は「準備中」と表示する
  contactFormUrl: 'https://docs.google.com/forms/d/e/1FAIpQLScvesNTJJXxkJnqi2IkTxECWDbnjXh0aNx57aDp4weuMrglaA/viewform' as string | null,
  // Google Analytics（GA4）の測定ID。本番ビルドだけで読み込む（/dev/ 以下は除く）
  gaMeasurementId: 'G-QN4G6TXQK9' as string | null,
  // 正式公開（v1）まで true。false にするときは public/robots.txt も書き換える
  noindex: true,
  // OGP画像（1200×630px）。運営者が public/ に置いたらパスを設定する（例：'/og-default.png'）
  ogImage: '/og-default.jpg' as string | null,
  // トップページのヒーロー画像（装飾ビジュアル。2:1・推奨2400×1200px・透過PNG/WebP）。置いたらパスを設定する
  heroImage: '/hero.webp' as string | null,
  // ヒーロー画像の説明（読み上げ用）。装飾だけの画像なら空のままでよい
  heroImageAlt: '',
};
