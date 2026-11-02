// ナビゲーションのリンク先（リンク先を変えるときはここだけ直す）

export interface NavLink {
  label: string;
  href: string;
}

export const SEARCH_HREF = '/dojin/fairs/';

export const HEADER_LINKS: NavLink[] = [
  { label: 'フェアを探す', href: '/dojin/' },
  { label: '印刷所一覧', href: '/dojin/printer/' },
  { label: 'このサイトについて', href: '/about/' },
];

export const FOOTER_LINKS: NavLink[] = [
  { label: '運営者情報', href: '/about/' },
  { label: '掲載方針', href: '/policy/' },
  { label: 'プライバシーポリシー', href: '/privacy/' },
  { label: '免責事項', href: '/disclaimer/' },
  { label: 'お問い合わせ', href: '/contact/' },
];

/** 一覧ページ（6つの見方と更新。timing-design 3章）。トップのタブもこの順に並べる */
export const LIST_PAGES = {
  new: { label: '新着', href: '/dojin/new/' },
  now: { label: '今開催中', href: '/dojin/now/' },
  'this-month': { label: '今月使える', href: '/dojin/this-month/' },
  'next-month': { label: '来月使える', href: '/dojin/next-month/' },
  'this-year': { label: '年内使える', href: '/dojin/this-year/' },
  ongoing: { label: '通年・常設', href: '/dojin/ongoing/' },
  updated: { label: '更新されたフェア', href: '/dojin/updated/' },
} satisfies Record<string, NavLink>;

/** タブの下の「もっと見る」に出す名前 */
export const MORE_LABELS: Record<string, string> = {
  new: '新着フェア',
  now: '今開催中のフェア',
  'this-month': '今月使えるフェア',
  'next-month': '来月使えるフェア',
  'this-year': '年内に使えるフェア',
  ongoing: '通年・常設の割引',
};

/** トップのタブ（この順に並べる。最初が初期表示） */
export const TAB_VIEWS = ['new', 'now', 'this-month', 'next-month', 'this-year', 'ongoing'] as const;

/** トップのタブ用の部品ページ（一覧と同じデータ・同じカードから作る。sitemap・検索エンジンの対象外） */
export const tabFragmentHref = (view: string) => `/dojin/tab/${view}/`;

export const PRINTERS_HREF = '/dojin/printer/';

/** トップの「加工・特典から探す」へのリンク（時期別導線の「加工から探す」から飛ぶ） */
export const POPULAR_PROCESS_ANCHOR = '#popular-processes';

/**
 * 加工・特典から探す。
 * 加工以外（印刷方式・特典）も含むため、リンク先は検索ページのクエリで受ける
 */
export const POPULAR_PROCESS_LINKS: NavLink[] = [
  { label: '箔押し', href: `${SEARCH_HREF}?process=foil` },
  { label: '特殊紙', href: `${SEARCH_HREF}?process=special_paper` },
  { label: '割引', href: `${SEARCH_HREF}?benefit=discount` },
  { label: 'PP加工', href: `${SEARCH_HREF}?process=pp,matte_pp,hologram_pp,special_pp` },
  { label: '遊び紙', href: `${SEARCH_HREF}?process=endpaper` },
  { label: '用紙変更', href: `${SEARCH_HREF}?benefit=free_paper_upgrade` },
  { label: '小口染め', href: `${SEARCH_HREF}?process=edge_dyeing` },
  { label: 'その他', href: SEARCH_HREF },
];
