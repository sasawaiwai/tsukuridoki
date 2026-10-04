// サイト全体の設定

export const SITE = {
  name: 'ツクリドキ！',
  subtitle: '同人誌印刷所フェアまとめサイト',
  tagline: '本が作りたくなる、同人誌印刷所フェアまとめサイト',
  // 正式公開（v1）まで true。false にするときは public/robots.txt も書き換える
  noindex: true,
  // OGP画像（1200×630px）。運営者が public/ に置いたらパスを設定する（例：'/og-default.png'）
  ogImage: null as string | null,
  // トップページのヒーロー画像（4:3・推奨1600×1200px）。置いたらパスを設定する
  heroImage: null as string | null,
};
