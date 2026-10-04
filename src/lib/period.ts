// 時期判定ロジック（仕様書 10〜12章・36〜38章）
// 日付は YYYY-MM-DD の文字列で扱い、計算時だけ「1970-01-01 からの日数」に変換する。
// 「今日」は必ず引数で受け取る（ビルド時は todayJST()、テストでは任意の日付）。

import type { DateString, Fair } from './types.ts';

export type FairStatus = 'upcoming' | 'active' | 'expired' | 'unknown';

const DAY_MS = 24 * 60 * 60 * 1000;
const NEW_BADGE_DAYS = 14;
const WITHIN_DAYS = 7;
const ENDING_SOON_DAYS = 7;

/** 日本時間の今日（YYYY-MM-DD） */
export function todayJST(now: Date = new Date()): DateString {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function toDayNumber(date: DateString): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

function fromDayNumber(n: number): DateString {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** b − a の日数 */
export function diffDays(a: DateString, b: DateString): number {
  return toDayNumber(b) - toDayNumber(a);
}

export function addDays(date: DateString, n: number): DateString {
  return fromDayNumber(toDayNumber(date) + n);
}

/** 暦の月で n か月後。存在しない日は月末に丸める（8/31 の 6か月後 → 2/28） */
export function addMonths(date: DateString, n: number): DateString {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** F：判定に使う開始日。usable_from、なければ start_date */
export function effectiveFrom(fair: Fair): DateString | null {
  return fair.usable_from ?? fair.start_date ?? null;
}

/** U：判定に使う終了日。usable_until、なければ end_date */
export function effectiveUntil(fair: Fair): DateString | null {
  return fair.usable_until ?? fair.end_date ?? null;
}

/** 状態（10-3）。F が null なら開始済み、U が null なら終了日不明として扱う */
export function getStatus(fair: Fair, today: DateString): FairStatus {
  const from = effectiveFrom(fair);
  const until = effectiveUntil(fair);
  if (from === null && until === null) return 'unknown';
  if (from !== null && from > today) return 'upcoming';
  if (until !== null && until < today) return 'expired';
  return 'active';
}

/** 今から7日以内に入稿できるか（10-4） */
export function isWithin7Days(fair: Fair, today: DateString): boolean {
  const from = effectiveFrom(fair);
  const until = effectiveUntil(fair);
  if (from === null && until === null) return false;
  const startsInTime = from === null || from <= addDays(today, WITHIN_DAYS);
  const notEnded = until === null || until >= today;
  return startsInTime && notEnded;
}

/** n か月先でも使えるか（12-2）。U が null（なくなり次第終了等）は対象外 */
export function isUsableAfterMonths(fair: Fair, today: DateString, months: number): boolean {
  const from = effectiveFrom(fair);
  const until = effectiveUntil(fair);
  if (until === null) return false;
  const target = addMonths(today, months);
  return (from === null || from <= target) && until >= target;
}

/** 終了間近か（38章）：今日 ≦ U ≦ 今日＋7日 */
export function isEndingSoon(fair: Fair, today: DateString): boolean {
  const until = effectiveUntil(fair);
  if (until === null) return false;
  const days = diffDays(today, until);
  return days >= 0 && days <= ENDING_SOON_DAYS;
}

/** 終了間近ラベル：「本日終了」「明日終了」「あとN日」。対象外は null */
export function endingLabel(fair: Fair, today: DateString): string | null {
  if (!isEndingSoon(fair, today)) return null;
  const days = diffDays(today, effectiveUntil(fair)!);
  if (days === 0) return '本日終了';
  if (days === 1) return '明日終了';
  return `あと${days}日`;
}

/** 次の週末（11-2）：今日より後に来る最初の土曜日と、その翌日の日曜日 */
export function nextWeekend(today: DateString): { saturday: DateString; sunday: DateString } {
  const dow = new Date(toDayNumber(today) * DAY_MS).getUTCDay(); // 0=日 … 6=土
  const untilSaturday = (6 - dow + 7) % 7 || 7;
  const saturday = addDays(today, untilSaturday);
  return { saturday, sunday: addDays(saturday, 1) };
}

/**
 * 次の週末に間に合うか（11-2）。簡易判定はしない。
 * イベント日が次の週末にあり、イベント納品の入稿締切が公式に明記され、
 * その締切がまだ来ておらず、締切日時点でフェアが使える場合のみ true。
 */
export function isNextWeekend(fair: Fair, today: DateString): boolean {
  const { event_date: eventDate, event_deadline: deadline } = fair;
  if (!eventDate || !deadline) return false;
  const { saturday, sunday } = nextWeekend(today);
  if (eventDate < saturday || eventDate > sunday) return false;
  if (deadline < today) return false;
  const from = effectiveFrom(fair);
  const until = effectiveUntil(fair);
  if (until === null) return false;
  return (from === null || from <= deadline) && deadline <= until;
}

function withinBadgeDays(date: DateString | null | undefined, today: DateString): boolean {
  if (!date) return false;
  const days = diffDays(date, today);
  return days >= 0 && days < NEW_BADGE_DAYS;
}

/** NEW表示（36章）：掲載日を1日目として14日目まで */
export function isNew(fair: Fair, today: DateString): boolean {
  return withinBadgeDays(fair.published_at, today);
}

/** UPDATE表示（37章）：更新日を1日目として14日目まで */
export function isUpdated(fair: Fair, today: DateString): boolean {
  return withinBadgeDays(fair.updated_at, today);
}
