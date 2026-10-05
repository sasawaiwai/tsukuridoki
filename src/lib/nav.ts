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

/** 時期別一覧（仕様書14章） */
export const PERIOD_PAGES = {
  within7Days: { label: '今から7日以内', href: '/dojin/within-7-days/' },
  nextWeekend: { label: '次の週末に間に合う', href: '/dojin/next-weekend/' },
  month1: { label: '1か月先でも', href: '/dojin/1month/' },
  month2: { label: '2か月先でも', href: '/dojin/2months/' },
  month3: { label: '3か月先でも', href: '/dojin/3months/' },
  month6: { label: '半年先でも', href: '/dojin/6months/' },
  new: { label: '新着', href: '/dojin/new/' },
  endingSoon: { label: 'もうすぐ終了', href: '/dojin/ending-soon/' },
  updated: { label: '更新されたフェア', href: '/dojin/updated/' },
} satisfies Record<string, NavLink>;

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
