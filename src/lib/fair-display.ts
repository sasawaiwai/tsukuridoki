// フェアカード用の表示データを作る（仕様書 27章・52章）

import type { DateString, Fair, Process } from './types.ts';
import { cardLabel, diffDays, effectiveFrom, effectiveUntil, getStatus, timingType, type CardLabelKind } from './period.ts';
import { BENEFIT_LABELS, PRINTING_METHOD_LABELS, SIZE_LABELS } from './labels.ts';

/** カード上部の色の分類（52-3） */
export type CardCategory = 'foil' | 'paper' | 'rgb' | 'surface' | 'craft' | 'deal' | 'other';

const CRAFT_PROCESSES = new Set(['endpaper', 'perforation', 'hole_punch']);
const CARD_CHIP_LIMIT = 5;
const RECHECK_DAYS = 30;

export interface Chip {
  label: string;
  category?: CardCategory; // 加工のチップだけ色を付ける
}

export interface CardModel {
  href: string;
  name: string;
  printer: string;
  category: CardCategory;
  label: { kind: CardLabelKind; text: string } | null;
  benefit: string;
  chips: Chip[];
  hiddenChipCount: number;
  deadline: string;
}

export type ProcessGroups = Map<string, Process>;

export function processMap(processes: Process[]): ProcessGroups {
  return new Map(processes.map((p) => [p.process_id, p]));
}

/** 1つの加工の色分類 */
export function processCategory(processId: string, processes: ProcessGroups): CardCategory {
  const group = processes.get(processId)?.group;
  if (group === 'foil_cover') return 'foil';
  if (processId === 'special_paper') return 'paper';
  if (group === 'surface') return 'surface';
  if (group === 'edge' || group === 'cutting' || CRAFT_PROCESSES.has(processId)) return 'craft';
  return 'other';
}

/** カード上部の色（52-3）：決まった順で最初に当てはまるもの */
export function cardCategory(fair: Fair, processes: ProcessGroups): CardCategory {
  const categories = new Set((fair.processes ?? []).map((id) => processCategory(id, processes)));
  if (categories.has('foil')) return 'foil';
  if (categories.has('paper') || fair.papers) return 'paper';
  if (fair.color_modes?.includes('RGB') || fair.rgb_supported) return 'rgb';
  if (categories.has('surface')) return 'surface';
  if (categories.has('craft')) return 'craft';
  if (fair.benefit_types?.some((b) => b === 'discount' || b === 'points')) return 'deal';
  return 'other';
}

/** 「何がお得か」の短い一文（27章）。benefit_summary がなければ構造化データから作る */
export function benefitText(fair: Fair, processes: ProcessGroups): string {
  if (fair.benefit_summary) return fair.benefit_summary;
  const processNames = (fair.processes ?? []).map((id) => processes.get(id)?.name ?? id);

  const parts = (fair.benefit_types ?? []).map((type) => {
    switch (type) {
      case 'discount': {
        const amount = fair.discount_rate
          ? `${fair.discount_rate}%OFF`
          : fair.discount_amount
            ? `${fair.discount_amount.toLocaleString('ja-JP')}円引き`
            : '割引';
        return processNames.length === 1 ? `${processNames[0]} ${amount}` : amount;
      }
      case 'free_process':
        return processNames.length > 0 ? `${processNames.join('・')}無料` : BENEFIT_LABELS.free_process;
      case 'free_option':
        return fair.free_options?.length ? `${fair.free_options.join('・')}無料` : BENEFIT_LABELS.free_option;
      case 'novelty':
        return 'ノベルティ付き';
      case 'points':
        return 'ポイント付与';
      default:
        return BENEFIT_LABELS[type];
    }
  });
  return parts.join('／');
}

/** 加工 → サイズ → 印刷方式 → 色方式（RGB・特色のみ）の順のチップ（52-6） */
export function cardChips(fair: Fair, processes: ProcessGroups): Chip[] {
  return [
    ...(fair.processes ?? []).map((id) => ({
      label: processes.get(id)?.name ?? id,
      category: processCategory(id, processes),
    })),
    ...(fair.sizes ?? []).map((s) => ({ label: SIZE_LABELS[s] })),
    ...(fair.printing_methods ?? []).map((m) => ({ label: PRINTING_METHOD_LABELS[m] })),
    ...(fair.color_modes?.includes('RGB') ? [{ label: 'RGB対応' }] : []),
    ...(fair.color_modes?.includes('spot_color') ? [{ label: '特色' }] : []),
  ];
}

/** 2026-11-30 → 11月30日 */
export function formatJpDate(date: DateString): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}月${d}日`;
}

/** 2026-11-30 → 2026年11月30日 */
export function formatJpDateFull(date: DateString): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

/** 公式情報の確認日（29-2）：verified_at と last_checked_at の新しい方 */
export function confirmedAt(fair: Fair): DateString | null {
  const dates = [fair.verified_at, fair.last_checked_at].filter((d): d is DateString => !!d);
  return dates.length > 0 ? dates.sort().at(-1)! : null;
}

/** 確認日が30日以上前、または確認日がない（29-3） */
export function needsRecheck(fair: Fair, today: DateString): boolean {
  const date = confirmedAt(fair);
  return date === null || diffDays(date, today) >= RECHECK_DAYS;
}

/** 入稿日限定で、期限の表示に並べる入稿日の数（それより多いときは「ほか」） */
const SUBMISSION_DATES_SHOWN = 3;

/**
 * カード下部の期限表示（timing-design 4-3）。
 * 入稿日限定は「入稿日限定：10月15日・11月19日」（過ぎた日は出さない）、通年・常設は「通年・常設」。
 * 期間限定で終了日が決まっていないときは、原文（なくなり次第終了など）か「終了日未定」
 */
export function deadlineText(fair: Fair, today: DateString): string {
  const status = getStatus(fair, today);
  if (status === 'expired') return '終了しました';
  const type = timingType(fair);
  if (type === 'ongoing') return '通年・常設';
  if (type === 'specific_dates') {
    const dates = (fair.submission_dates ?? []).map((d) => d.date).filter((d) => d >= today).sort();
    const shown = dates.slice(0, SUBMISSION_DATES_SHOWN).map(formatJpDate).join('・');
    return `入稿日限定：${shown}${dates.length > SUBMISSION_DATES_SHOWN ? 'ほか' : ''}`;
  }
  if (status === 'upcoming') return `${formatJpDate(effectiveFrom(fair)!)}から利用可能`;
  const until = effectiveUntil(fair);
  const text = fair.usable_until_text ?? fair.end_date_text;
  if (text) return text;
  if (until) return `${formatJpDate(until)}まで`;
  return effectiveFrom(fair) ? '終了日未定' : '期間未定';
}

export function toCardModel(
  fair: Fair,
  context: { printerName: string; processes: ProcessGroups; today: DateString },
): CardModel {
  const chips = cardChips(fair, context.processes);
  return {
    href: `/dojin/fairs/${fair.slug}/`,
    name: fair.fair_name,
    printer: context.printerName,
    category: cardCategory(fair, context.processes),
    label: cardLabel(fair, context.today),
    benefit: benefitText(fair, context.processes),
    chips: chips.slice(0, CARD_CHIP_LIMIT),
    hiddenChipCount: Math.max(0, chips.length - CARD_CHIP_LIMIT),
    deadline: deadlineText(fair, context.today),
  };
}
