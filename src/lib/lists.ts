// 一覧ページの定義（仕様書10〜12章・14章・36〜39章）

import type { DateString, Fair, SiteData } from './types.ts';
import { addMonths, deadlineDate, effectiveUntil, inView, timingRank, viewDate, type ViewKey } from './period.ts';
import { colorValues, isExpired } from './search.ts';
import { BENEFIT_LABELS, COLOR_MODE_LABELS, PRINTING_METHOD_LABELS, SIZE_LABELS } from './labels.ts';

/** 新しく掲載された順 */
export function byPublishedDesc(a: Fair, b: Fair): number {
  return b.published_at.localeCompare(a.published_at);
}

/** 終了日が近い順（終了日不明は最後） */
export function byUntilAsc(a: Fair, b: Fair): number {
  return (effectiveUntil(a) ?? '9999-12-31').localeCompare(effectiveUntil(b) ?? '9999-12-31');
}

/** 終了日が新しい順（アーカイブ用） */
export function byUntilDesc(a: Fair, b: Fair): number {
  return byUntilAsc(b, a);
}

export interface ListPage {
  slug: string; // /dojin/{slug}/
  title: string;
  description: string;
  select: (fairs: Fair[]) => Fair[];
}

/** 一覧ページの1ページあたりの件数（PCの3列・4列で割り切れる。timing-design 4-2） */
export const LIST_PAGE_SIZE = 24;
/** トップのタブに出す件数 */
export const TAB_SIZE = 10;

/** 並び順のグループ（①日付あり → ②定期開催 → ③通年・常設。仕様書57章） */
const byRank = (a: Fair, b: Fair) => timingRank(a) - timingRank(b);

/** グループごとに、その見方で最初に使える日が近い順、同じなら終わりが近い順 */
function byViewDate(view: ViewKey, today: DateString) {
  const deadline = (f: Fair) => deadlineDate(f, today) ?? '9999-12-31';
  return (a: Fair, b: Fair) =>
    byRank(a, b) ||
    (viewDate(a, view, today) ?? '').localeCompare(viewDate(b, view, today) ?? '') ||
    deadline(a).localeCompare(deadline(b));
}

/** グループごとに、掲載日の新しい順（印刷所別・属性別の一覧でも使う） */
export const byRankThenPublished = (a: Fair, b: Fair) => byRank(a, b) || byPublishedDesc(a, b);

/** 6つの見方（新着・今開催中・今月・来月・年内・通年常設）と、更新されたフェアの一覧（timing-design 3章） */
export function listPages(today: DateString): ListPage[] {
  const month = Number(today.slice(5, 7));
  const nextMonth = Number(addMonths(`${today.slice(0, 7)}-01`, 1).slice(5, 7));
  const year = today.slice(0, 4);
  const view = (slug: ViewKey, title: string, description: string): ListPage => ({
    slug,
    title,
    description: `${description}いつでも使える割引（定期開催・通年・常設）は、期間のあるフェアの後ろに載せています。`,
    select: (fairs) => fairs.filter((f) => inView(f, slug, today)).sort(byViewDate(slug, today)),
  });

  return [
    {
      slug: 'new',
      title: '新着フェア',
      description: 'ツクリドキ！に新しく掲載されたフェアです。これから始まるフェアも含みます。掲載日の新しい順に並べています（通年・常設の割引は「通年・常設」でご覧ください）。',
      select: (fairs) => fairs.filter((f) => inView(f, 'new', today)).sort(byPublishedDesc),
    },
    view('now', '今開催中のフェア', '今日使えるフェアです。終わりが近い順に並べています。'),
    view('this-month', `今月（${month}月）使えるフェア`, `今日から${month}月末までの間に、使える日があるフェアです。`),
    view('next-month', `来月（${nextMonth}月）使えるフェア`, `${nextMonth}月中に使える日があるフェアです。終了日が決まっていないフェア（なくなり次第終了など）は含みません。`),
    view('this-year', '年内に使えるフェア', `今日から${year}年12月31日までの間に、少なくとも1日使えるフェアです。`),
    {
      slug: 'ongoing',
      title: '通年・常設の割引',
      description: '期間の定めがなく、いつでも使える割引・サービスです（イベントごとの早割のような定期開催も含みます）。条件が変わることがあるので、利用前に公式サイトでご確認ください。',
      select: (fairs) => fairs.filter((f) => inView(f, 'ongoing', today)).sort(byRankThenPublished),
    },
    {
      slug: 'updated',
      title: '更新されたフェア',
      description: '期間の延長など、内容が更新されたフェアです。更新日の新しい順に並べています。',
      select: (fairs) =>
        fairs
          .filter((f) => !isExpired(f, today) && f.updated_at)
          .sort((a, b) => b.updated_at!.localeCompare(a.updated_at!)),
    },
  ];
}

export type AttributeAxis = 'process' | 'size' | 'printing' | 'color' | 'benefit';

export interface AttributeValue {
  axis: AttributeAxis;
  value: string;
  label: string;
  href: string;
  title: string;
}

interface AxisDef {
  axis: AttributeAxis;
  label: string;
  options: (data: SiteData) => { value: string; label: string }[];
  of: (fair: Fair) => string[];
  title: (label: string) => string;
}

const entries = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

export const ATTRIBUTE_AXES: AxisDef[] = [
  {
    axis: 'process',
    label: '加工',
    options: (data) => data.processes.map((p) => ({ value: p.process_id, label: p.name })),
    of: (f) => f.processes ?? [],
    title: (label) => `${label}のフェア`,
  },
  {
    axis: 'size',
    label: 'サイズ',
    options: () => entries(SIZE_LABELS),
    of: (f) => f.sizes ?? [],
    title: (label) => `${label}サイズで使えるフェア`,
  },
  {
    axis: 'printing',
    label: '印刷方式',
    options: () => entries(PRINTING_METHOD_LABELS),
    of: (f) => f.printing_methods ?? [],
    title: (label) => `${label}印刷で使えるフェア`,
  },
  {
    axis: 'color',
    label: '色・入稿方式',
    options: () => entries(COLOR_MODE_LABELS),
    of: colorValues,
    title: (label) => `${label}のフェア`,
  },
  {
    axis: 'benefit',
    label: '特典',
    options: () => entries(BENEFIT_LABELS),
    of: (f) => f.benefit_types ?? [],
    title: (label) => `特典が「${label}」のフェア`,
  },
];

/**
 * 属性別ページを作る値（決定事項B）：フェアが1件以上（終了済み含む）ある値だけ。
 * フェアのデータは削除しないので、一度できたページは消えない。
 */
export function attributeValues(data: SiteData): AttributeValue[] {
  return ATTRIBUTE_AXES.flatMap((def) => {
    const used = new Set(data.fairs.flatMap(def.of));
    return def
      .options(data)
      .filter((o) => used.has(o.value))
      .map((o) => ({
        axis: def.axis,
        value: o.value,
        label: o.label,
        href: `/dojin/${def.axis}/${o.value}/`,
        title: def.title(o.label),
      }));
  });
}

export function fairsWithAttribute(fairs: Fair[], axis: AttributeAxis, value: string): Fair[] {
  const def = ATTRIBUTE_AXES.find((d) => d.axis === axis)!;
  return fairs.filter((f) => def.of(f).includes(value));
}

/** 終了年（U の年）。アーカイブ用 */
export function endYear(fair: Fair): string | null {
  return effectiveUntil(fair)?.slice(0, 4) ?? null;
}

/** 終了済みフェアがある年（新しい順） */
export function archiveYears(fairs: Fair[], today: DateString): string[] {
  const years = new Set(fairs.filter((f) => isExpired(f, today)).map(endYear).filter((y): y is string => y !== null));
  return [...years].sort().reverse();
}
