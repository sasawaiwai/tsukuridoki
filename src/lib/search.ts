// 絞り込み（仕様書41章）。属性別ページ（ビルド時）と検索ページ（ブラウザ）で共用する。
// カードの見た目とは切り離してあるので、件数が増えたらこの処理のまま検索用JSON方式へ置き換えられる。

import type { DateString, Fair } from './types.ts';
import { getStatus, isNextWeekend, isUsableAfterMonths, isWithin7Days } from './period.ts';

/** クエリ名（41-2）。include_expired は別扱い */
export const SEARCH_KEYS = ['period', 'printer', 'process', 'size', 'printing', 'color', 'benefit'] as const;
export type SearchKey = (typeof SEARCH_KEYS)[number];

export type SearchAttributes = Record<SearchKey, string[]>;

export interface SearchQuery {
  filters: Partial<Record<SearchKey, string[]>>;
  includeExpired: boolean;
}

/** 時期の条件（値は時期別一覧のURLと同じ） */
export const PERIOD_FILTERS: Record<string, (fair: Fair, today: DateString) => boolean> = {
  'within-7-days': isWithin7Days,
  'next-weekend': isNextWeekend,
  '1month': (fair, today) => isUsableAfterMonths(fair, today, 1),
  '2months': (fair, today) => isUsableAfterMonths(fair, today, 2),
  '3months': (fair, today) => isUsableAfterMonths(fair, today, 3),
  '6months': (fair, today) => isUsableAfterMonths(fair, today, 6),
};

/** 色方式。RGB・特色は「対応」フラグも含める */
export function colorValues(fair: Fair): string[] {
  const values = new Set<string>(fair.color_modes ?? []);
  if (fair.rgb_supported) values.add('RGB');
  if (fair.spot_color_supported) values.add('spot_color');
  return [...values];
}

/** フェアが持つ絞り込み用の値 */
export function searchAttributes(fair: Fair, today: DateString): SearchAttributes {
  return {
    period: Object.keys(PERIOD_FILTERS).filter((key) => PERIOD_FILTERS[key](fair, today)),
    printer: [fair.printer_id],
    process: fair.processes ?? [],
    size: fair.sizes ?? [],
    printing: fair.printing_methods ?? [],
    color: colorValues(fair),
    benefit: fair.benefit_types ?? [],
  };
}

export function isExpired(fair: Fair, today: DateString): boolean {
  return getStatus(fair, today) === 'expired';
}

/** URLのクエリ → 条件。カンマ区切り（process=pp,matte_pp）と同じキーの繰り返しの両方を受け付ける */
export function parseQuery(params: URLSearchParams): SearchQuery {
  const filters: SearchQuery['filters'] = {};
  for (const key of SEARCH_KEYS) {
    const values = params
      .getAll(key)
      .flatMap((v) => v.split(','))
      .map((v) => v.trim())
      .filter(Boolean);
    if (values.length > 0) filters[key] = [...new Set(values)];
  }
  const expired = params.get('include_expired');
  return { filters, includeExpired: expired === '1' || expired === 'true' };
}

/** 条件 → URLのクエリ（先頭の ? なし） */
export function toQueryString(query: SearchQuery): string {
  const params = new URLSearchParams();
  for (const key of SEARCH_KEYS) {
    const values = query.filters[key];
    if (values && values.length > 0) params.set(key, values.join(','));
  }
  if (query.includeExpired) params.set('include_expired', '1');
  return params.toString().replaceAll('%2C', ',');
}

/** 条件に合うか。軸どうしは AND、同じ軸の中は OR（41-2） */
export function matches(attributes: SearchAttributes, expired: boolean, query: SearchQuery): boolean {
  if (expired && !query.includeExpired) return false;
  return SEARCH_KEYS.every((key) => {
    const wanted = query.filters[key];
    if (!wanted || wanted.length === 0) return true;
    return wanted.some((value) => attributes[key].includes(value));
  });
}
