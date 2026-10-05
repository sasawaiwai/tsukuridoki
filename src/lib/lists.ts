// 一覧ページの定義（仕様書10〜12章・14章・36〜39章）

import type { DateString, Fair, SiteData } from './types.ts';
import { addMonths, effectiveUntil, isEndingSoon, nextWeekend } from './period.ts';
import { PERIOD_FILTERS, colorValues, isExpired } from './search.ts';
import { formatJpDate, formatJpDateFull } from './fair-display.ts';
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

/** 時期別・新着・更新・終了間近の一覧 */
export function listPages(today: DateString): ListPage[] {
  const open = (fairs: Fair[]) => fairs.filter((f) => !isExpired(f, today));
  const period = (key: string) => (fairs: Fair[]) => fairs.filter((f) => PERIOD_FILTERS[key](f, today)).sort(byUntilAsc);
  const weekend = nextWeekend(today);
  const months = (n: number, label: string): ListPage => ({
    slug: `${n}month${n > 1 ? 's' : ''}`,
    title: `${label}先でも使えるフェア`,
    description: `${label}後（${formatJpDateFull(addMonths(today, n))}）に入稿しても使えるフェアです。終了日が決まっていないフェア（なくなり次第終了など）は含みません。`,
    select: period(`${n}month${n > 1 ? 's' : ''}`),
  });

  return [
    {
      slug: 'within-7-days',
      title: '今から7日以内に入稿できるフェア',
      description: '今日から7日以内に入稿すれば使えるフェアです。開始前のフェアは、利用できるようになる日を表示しています。',
      select: period('within-7-days'),
    },
    {
      slug: 'next-weekend',
      title: '次の週末のイベントに間に合うフェア',
      description: `次の週末（${formatJpDate(weekend.saturday)}・${formatJpDate(weekend.sunday)}）のイベント向けの入稿締切が公式に案内されていて、その締切までに使えるフェアだけを載せています。`,
      select: period('next-weekend'),
    },
    months(1, '1か月'),
    months(2, '2か月'),
    months(3, '3か月'),
    months(6, '半年'),
    {
      slug: 'new',
      title: '新着フェア',
      description: '新しく掲載されたフェアです。掲載日の新しい順に並べています。',
      select: (fairs) => open(fairs).sort(byPublishedDesc),
    },
    {
      slug: 'updated',
      title: '更新されたフェア',
      description: '期間の延長など、内容が更新されたフェアです。更新日の新しい順に並べています。',
      select: (fairs) =>
        open(fairs)
          .filter((f) => f.updated_at)
          .sort((a, b) => b.updated_at!.localeCompare(a.updated_at!)),
    },
    {
      slug: 'ending-soon',
      title: 'もうすぐ終了するフェア',
      description: '7日以内に終了するフェアです。終了が近い順に並べています。',
      select: (fairs) => fairs.filter((f) => isEndingSoon(f, today)).sort(byUntilAsc),
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
