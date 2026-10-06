// ナビゲーションのリンク先（リンク先を変えるときはここだけ直す）

import type { CardCategory } from './fair-display.ts';

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

/** トップの「人気の加工から探す」へのリンク（時期別導線の「加工から探す」から飛ぶ） */
export const POPULAR_PROCESS_ANCHOR = '#popular-processes';

/**
 * 人気の加工から探す（参考画像）。glyph は丸い見本に置く一文字。
 * 加工以外（印刷方式・特典）も含むため、リンク先は検索ページのクエリで受ける
 */
export const POPULAR_PROCESS_LINKS: (NavLink & { category: CardCategory; glyph: string })[] = [
  { label: '箔押し', glyph: '箔', href: `${SEARCH_HREF}?process=foil`, category: 'foil' },
  { label: '特殊紙', glyph: '紙', href: `${SEARCH_HREF}?process=special_paper`, category: 'paper' },
  { label: '割引', glyph: '割', href: `${SEARCH_HREF}?benefit=discount`, category: 'deal' },
  { label: 'PP加工', glyph: 'PP', href: `${SEARCH_HREF}?process=pp,matte_pp,hologram_pp,special_pp`, category: 'surface' },
  { label: '遊び紙', glyph: '遊', href: `${SEARCH_HREF}?process=endpaper`, category: 'craft' },
  { label: '用紙変更', glyph: '替', href: `${SEARCH_HREF}?benefit=free_paper_upgrade`, category: 'paper' },
  { label: '小口染め', glyph: '染', href: `${SEARCH_HREF}?process=edge_dyeing`, category: 'craft' },
  { label: 'その他', glyph: '…', href: SEARCH_HREF, category: 'other' },
];
