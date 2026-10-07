// 時期判定ロジック（仕様書 10〜12章・36〜38章）
// 日付は YYYY-MM-DD の文字列で扱い、計算時だけ「1970-01-01 からの日数」に変換する。
// 「今日」は必ず引数で受け取る（ビルド時は todayJST()、テストでは任意の日付）。

import type { DateString, Fair, TimingType } from './types.ts';

export type FairStatus = 'upcoming' | 'active' | 'expired' | 'unknown';

const DAY_MS = 24 * 60 * 60 * 1000;
const BADGE_DAYS = 7;
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

/** 開催タイプ。省略時は期間限定（仕様書57章） */
export function timingType(fair: Fair): TimingType {
  return fair.timing_type ?? 'period';
}

/** いつでも使える開催タイプ（通年・常設、定期開催）。日付の項目を持たない */
export function isAlwaysAvailable(fair: Fair): boolean {
  const type = timingType(fair);
  return type === 'ongoing' || type === 'recurring';
}

/**
 * 一覧の並び順のグループ（仕様書57章）。どの見方でも
 * ①日付のある期間限定・入稿日限定 → ②定期開催 → ③通年・常設 の順に並べる
 */
export function timingRank(fair: Fair): number {
  const type = timingType(fair);
  if (type === 'recurring') return 1;
  if (type === 'ongoing') return 2;
  return 0;
}

/** 入稿日限定の入稿日（日付順） */
function submissionDates(fair: Fair): DateString[] {
  return (fair.submission_dates ?? []).map((d) => d.date).sort();
}

/**
 * F：判定に使う開始日。期間限定は usable_from、なければ start_date。
 * 入稿日限定は最初の入稿日。通年・常設・定期開催は null
 */
export function effectiveFrom(fair: Fair): DateString | null {
  const type = timingType(fair);
  if (type === 'specific_dates') return submissionDates(fair)[0] ?? null;
  if (isAlwaysAvailable(fair)) return null;
  return fair.usable_from ?? fair.start_date ?? null;
}

/**
 * U：判定に使う終了日。期間限定は usable_until、なければ end_date。
 * 入稿日限定は最後の入稿日。通年・常設・定期開催は null
 */
export function effectiveUntil(fair: Fair): DateString | null {
  const type = timingType(fair);
  if (type === 'specific_dates') return submissionDates(fair).at(-1) ?? null;
  if (isAlwaysAvailable(fair)) return null;
  return fair.usable_until ?? fair.end_date ?? null;
}

/**
 * 状態（10-3）。
 * - 期間限定：F が null なら開始済み、U が null なら終了日不明として扱う
 * - 入稿日限定：最後の入稿日を過ぎたら終了。今日が入稿日なら開催中、それ以外は次の入稿日を待つ開始前
 * - 通年・常設・定期開催：常に開催中
 */
export function getStatus(fair: Fair, today: DateString): FairStatus {
  const type = timingType(fair);
  if (isAlwaysAvailable(fair)) return 'active';
  if (type === 'specific_dates') {
    const dates = submissionDates(fair);
    if (dates.length === 0) return 'unknown';
    if (dates.at(-1)! < today) return 'expired';
    return dates.includes(today) ? 'active' : 'upcoming';
  }
  const from = effectiveFrom(fair);
  const until = effectiveUntil(fair);
  if (from === null && until === null) return 'unknown';
  if (from !== null && from > today) return 'upcoming';
  if (until !== null && until < today) return 'expired';
  return 'active';
}

// ---- 使える日の集まり（timing-design 2-2）と6つの見方（同 3章） ----

/** 使える期間。null は端が開いている */
interface Span {
  from: DateString | null;
  until: DateString | null;
}

/**
 * フェアを「使える日の集まり」に直す。時期の見方の判定はすべてここから行う。
 * - 期間限定：F〜U。U が不明（なくなり次第終了など）なら「今日（開始前なら開始日）までは使える」とする。
 *   F・U がどちらも不明なら空（時期の見方には出さない）
 * - 入稿日限定：入稿日それぞれ
 * - 通年・常設・定期開催：いつでも
 */
export function usableSpans(fair: Fair, today: DateString): Span[] {
  const type = timingType(fair);
  if (isAlwaysAvailable(fair)) return [{ from: null, until: null }];
  if (type === 'specific_dates') return submissionDates(fair).map((d) => ({ from: d, until: d }));
  const from = effectiveFrom(fair);
  const until = effectiveUntil(fair);
  if (from === null && until === null) return [];
  if (until !== null) return [{ from, until }];
  return [{ from, until: from !== null && from > today ? from : today }];
}

/** a〜b の間で最初に使える日。使えなければ null */
function firstUsableBetween(fair: Fair, today: DateString, a: DateString, b: DateString): DateString | null {
  const days = usableSpans(fair, today)
    .filter((s) => (s.from === null || s.from <= b) && (s.until === null || s.until >= a))
    .map((s) => (s.from === null || s.from < a ? a : s.from));
  return days.sort()[0] ?? null;
}

/** その月の末日 */
function endOfMonth(date: DateString): DateString {
  return addDays(addMonths(`${date.slice(0, 7)}-01`, 1), -1);
}

/** 6つの見方（トップのタブ・一覧ページ・検索の「時期」。timing-design 3章） */
export type ViewKey = 'new' | 'now' | 'this-month' | 'next-month' | 'this-year' | 'ongoing';

/** 時期の見方の範囲（「これから」使える日だけを見る） */
function viewRange(view: 'now' | 'this-month' | 'next-month' | 'this-year', today: DateString): [DateString, DateString] {
  if (view === 'now') return [today, today];
  if (view === 'this-month') return [today, endOfMonth(today)];
  if (view === 'next-month') {
    const first = addMonths(`${today.slice(0, 7)}-01`, 1);
    return [first, endOfMonth(first)];
  }
  return [today, `${today.slice(0, 4)}-12-31`];
}

/**
 * その見方で、最初に使える日（並び順に使う）。対象外なら null。
 * 新着・通年・常設タブは日付で選ばないので、対象なら今日を返す。
 * 通年・常設・定期開催は、時期の見方（今開催中・今月・来月・年内）すべてに入る（いつでも使えるため。仕様書57章）。新着には入れない
 */
export function viewDate(fair: Fair, view: ViewKey, today: DateString): DateString | null {
  // 新着には、いつでも使えるもの（通年・常設、定期開催）は出さない（仕様書57章）
  if (view === 'new') return isAlwaysAvailable(fair) || getStatus(fair, today) === 'expired' ? null : today;
  if (view === 'ongoing') return isAlwaysAvailable(fair) ? today : null;
  const [a, b] = viewRange(view, today);
  return firstUsableBetween(fair, today, a, b);
}

export function inView(fair: Fair, view: ViewKey, today: DateString): boolean {
  return viewDate(fair, view, today) !== null;
}

// ---- 終了間近・カードのラベル ----

/**
 * 期限の日：期間限定は U、入稿日限定は次の入稿日（今日以降で最初）、通年・常設・定期開催は null。
 * 「あとN日」「終了間近」の基準
 */
export function deadlineDate(fair: Fair, today: DateString): DateString | null {
  const type = timingType(fair);
  if (isAlwaysAvailable(fair)) return null;
  if (type === 'specific_dates') return submissionDates(fair).find((d) => d >= today) ?? null;
  return effectiveUntil(fair);
}

/** 終了間近か（38章）：今日 ≦ 期限の日 ≦ 今日＋7日 */
export function isEndingSoon(fair: Fair, today: DateString): boolean {
  const deadline = deadlineDate(fair, today);
  if (deadline === null) return false;
  const days = diffDays(today, deadline);
  return days >= 0 && days <= ENDING_SOON_DAYS;
}

/** 終了間近ラベル：「本日終了」「明日終了」「あとN日」（入稿日限定は「本日入稿日」「明日入稿日」「入稿日まであとN日」）。対象外は null */
export function endingLabel(fair: Fair, today: DateString): string | null {
  if (!isEndingSoon(fair, today)) return null;
  const days = diffDays(today, deadlineDate(fair, today)!);
  if (timingType(fair) === 'specific_dates') {
    if (days === 0) return '本日入稿日';
    if (days === 1) return '明日入稿日';
    return `入稿日まであと${days}日`;
  }
  if (days === 0) return '本日終了';
  if (days === 1) return '明日終了';
  return `あと${days}日`;
}

function withinBadgeDays(date: DateString | null | undefined, today: DateString): boolean {
  if (!date) return false;
  const days = diffDays(date, today);
  return days >= 0 && days < BADGE_DAYS;
}

/** NEW表示（36章）：掲載日を1日目として7日目まで */
export function isNew(fair: Fair, today: DateString): boolean {
  return withinBadgeDays(fair.published_at, today);
}

/** UPDATE表示（37章）：更新日を1日目として7日目まで */
export function isUpdated(fair: Fair, today: DateString): boolean {
  return withinBadgeDays(fair.updated_at, today);
}

export type CardLabelKind = 'urgent' | 'update' | 'new' | 'soon' | 'ended';

/**
 * カードの状態ラベル（52-2）。1個だけ返す。
 * 本日終了 → 明日終了 → あと2〜3日 → UPDATE → NEW → あと4〜7日 → なし
 */
export function cardLabel(fair: Fair, today: DateString): { kind: CardLabelKind; text: string } | null {
  if (getStatus(fair, today) === 'expired') return { kind: 'ended', text: '終了' };
  const deadline = deadlineDate(fair, today);
  const daysLeft = deadline === null ? null : diffDays(today, deadline);
  if (daysLeft !== null && daysLeft <= 3) return { kind: 'urgent', text: endingLabel(fair, today)! };
  if (isUpdated(fair, today)) return { kind: 'update', text: 'UPDATE' };
  if (isNew(fair, today)) return { kind: 'new', text: 'NEW' };
  if (daysLeft !== null && daysLeft <= ENDING_SOON_DAYS) return { kind: 'soon', text: endingLabel(fair, today)! };
  return null;
}
