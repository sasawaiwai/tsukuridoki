// トップの「加工・特典カテゴリ別の一覧」（仕様書40-2）
// 1件のフェアは、当てはまるカテゴリすべてに出す（元データは1件のまま。表示のために複製しない）。
// 判定に使うのは構造化された項目（processes・benefit_types）だけ。フェア名・説明文からは推測しない

import type { BenefitType, Fair } from './types.ts';
import type { CardCategory } from './fair-display.ts';

export interface FairCategory {
  /** アンカー（#cat-{key}）に使う */
  key: string;
  label: string;
  /** 見出しの左の色線（既存のカテゴリ色。仕様書52-3） */
  color: CardCategory;
  match: (fair: Fair) => boolean;
}

const hasProcess = (...ids: string[]) => (fair: Fair) => (fair.processes ?? []).some((p) => ids.includes(p));
const hasBenefit = (...types: BenefitType[]) => (fair: Fair) => (fair.benefit_types ?? []).some((b) => types.includes(b));

/**
 * カテゴリの順番：加工 → 特典。最後に「その他」（OTHER_CATEGORY）。
 * 「特色・カラー・RGB印刷」は加工の特色印刷・本文色刷りだけで判定する。
 * color_modes・rgb_supported は「RGB入稿もできる」という本の条件・対応可否で、フェアの中身ではないため使わない
 */
export const FAIR_CATEGORIES: FairCategory[] = [
  { key: 'foil', label: '箔押し', color: 'foil', match: hasProcess('foil', 'blind_emboss', 'emboss', 'deboss') },
  { key: 'special-paper', label: '特殊紙', color: 'paper', match: hasProcess('special_paper') },
  { key: 'pp', label: 'PP加工', color: 'surface', match: hasProcess('pp', 'matte_pp', 'hologram_pp', 'special_pp') },
  { key: 'endpaper', label: '遊び紙', color: 'craft', match: hasProcess('endpaper') },
  {
    key: 'cutting-edge',
    label: '角丸・型抜き・小口',
    color: 'craft',
    match: hasProcess('round_corner', 'die_cut', 'edge_dyeing', 'edge_printing', 'perforation', 'hole_punch'),
  },
  { key: 'color-printing', label: '特色・カラー・RGB印刷', color: 'rgb', match: hasProcess('spot_color_printing', 'color_body') },
  { key: 'free-process', label: '加工無料', color: 'deal', match: hasBenefit('free_process') },
  { key: 'free-option', label: 'オプション無料', color: 'deal', match: hasBenefit('free_option') },
  { key: 'free-paper', label: '用紙変更無料', color: 'deal', match: hasBenefit('free_paper_upgrade') },
  { key: 'discount', label: '割引', color: 'deal', match: hasBenefit('discount') },
  { key: 'points', label: 'ポイント', color: 'deal', match: hasBenefit('points') },
  { key: 'novelty', label: 'ノベルティ', color: 'deal', match: hasBenefit('novelty') },
  { key: 'limited', label: '限定商品・セット', color: 'deal', match: hasBenefit('limited_product', 'limited_set') },
];

/** どのカテゴリにも当たらないフェアだけの受け皿 */
export const OTHER_CATEGORY: FairCategory = {
  key: 'other',
  label: 'その他',
  color: 'other',
  match: (fair) => !FAIR_CATEGORIES.some((c) => c.match(fair)),
};

export interface CategoryGroup<T> {
  category: FairCategory;
  items: T[];
}

/**
 * フェアをカテゴリ別に分ける。
 * - 並び順は受け取った順のまま（各タブの並び順を保つ）
 * - 1つのカテゴリの中で同じフェアは1回だけ
 * - 0件のカテゴリは返さない
 * 総件数は fairs.length（重複なし）。各カテゴリの件数の合計はそれより多くなることがある
 */
export function groupByCategory<T>(fairs: Fair[], toItem: (fair: Fair) => T): CategoryGroup<T>[] {
  const unique = [...new Map(fairs.map((f) => [f.fair_id, f])).values()];
  return [...FAIR_CATEGORIES, OTHER_CATEGORY]
    .map((category) => ({ category, items: unique.filter(category.match).map(toItem) }))
    .filter((group) => group.items.length > 0);
}
