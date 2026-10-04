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

/** 加工から探す（phase1.5-design.md 9章）。複数の加工をまとめた項目は検索ページのクエリで受ける */
export const PROCESS_LINKS: (NavLink & { category: CardCategory })[] = [
  { label: '箔押し', href: `${SEARCH_HREF}?process=foil`, category: 'foil' },
  { label: '特殊紙', href: `${SEARCH_HREF}?process=special_paper`, category: 'paper' },
  { label: 'RGB印刷', href: `${SEARCH_HREF}?color=RGB`, category: 'rgb' },
  { label: 'PP加工', href: `${SEARCH_HREF}?process=pp,matte_pp,hologram_pp,special_pp`, category: 'surface' },
  { label: '小口加工', href: `${SEARCH_HREF}?process=edge_dyeing,edge_printing`, category: 'craft' },
  { label: '遊び紙', href: `${SEARCH_HREF}?process=endpaper`, category: 'craft' },
  { label: 'オンデマンド', href: `${SEARCH_HREF}?printing=ondemand`, category: 'other' },
  { label: 'オフセット', href: `${SEARCH_HREF}?printing=offset`, category: 'other' },
];
