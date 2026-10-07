import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Fair } from '../src/lib/types.ts';
import {
  addMonths,
  cardLabel,
  effectiveFrom,
  effectiveUntil,
  deadlineDate,
  endingLabel,
  getStatus,
  inView,
  isEndingSoon,
  isNew,
  isUpdated,
  todayJST,
  viewDate,
  type ViewKey,
} from '../src/lib/period.ts';

function fair(overrides: Partial<Fair>): Fair {
  return {
    fair_id: 'test-fair',
    slug: 'test-fair',
    fair_name: 'テストフェア',
    printer_id: 'test-printer',
    category: 'dojinshi',
    sources: ['https://example.com/'],
    summary: 'テスト',
    source_type: 'official_fair',
    verification_status: 'verified',
    published_at: '2026-01-01',
    ...overrides,
  };
}

const TODAY = '2026-10-04'; // 日曜日

test('todayJST：UTCの夜は日本時間では翌日になる', () => {
  assert.equal(todayJST(new Date('2026-10-04T15:30:00Z')), '2026-10-05');
  assert.equal(todayJST(new Date('2026-10-04T14:59:59Z')), '2026-10-04');
});

test('addMonths：月末の丸めとうるう年', () => {
  assert.equal(addMonths('2026-08-31', 6), '2027-02-28');
  assert.equal(addMonths('2027-01-31', 1), '2027-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(addMonths('2026-10-04', 3), '2027-01-04');
});

test('F・U：usable_* が優先され、null なら start/end で代用', () => {
  const f = fair({ start_date: '2026-10-01', end_date: '2026-11-30', usable_until: '2026-11-25' });
  assert.equal(effectiveFrom(f), '2026-10-01');
  assert.equal(effectiveUntil(f), '2026-11-25');
  const g = fair({ start_date: '2026-10-01', usable_from: '2026-10-05' });
  assert.equal(effectiveFrom(g), '2026-10-05');
  assert.equal(effectiveUntil(g), null);
});

test('状態：開始前・開始当日・終了当日・終了翌日・不明', () => {
  const f = fair({ start_date: '2026-10-04', end_date: '2026-10-10' });
  assert.equal(getStatus(f, '2026-10-03'), 'upcoming');
  assert.equal(getStatus(f, '2026-10-04'), 'active');
  assert.equal(getStatus(f, '2026-10-10'), 'active');
  assert.equal(getStatus(f, '2026-10-11'), 'expired');
  assert.equal(getStatus(fair({}), TODAY), 'unknown');
  assert.equal(getStatus(fair({ end_date: '2026-10-10' }), TODAY), 'active'); // F が null → 開始済み
  assert.equal(getStatus(fair({ start_date: '2026-09-01' }), TODAY), 'active'); // U が null → 終了日不明
});

const VIEWS: ViewKey[] = ['new', 'now', 'this-month', 'next-month', 'this-year', 'ongoing'];
/** 6つの見方のうち、出るものだけを返す */
const shownIn = (f: Fair, today: string) => VIEWS.filter((v) => inView(f, v, today));

test('6つの見方：timing-design 3-2 の例（今日＝10月6日）', () => {
  const today = '2026-10-06';
  const seeThrough = fair({ start_date: '2026-05-16', end_date: '2026-10-16' });
  const wabon = fair({ start_date: '2026-10-01', end_date: '2027-02-26' });
  const anniversary = fair({ timing_type: 'specific_dates', submission_dates: [{ date: '2026-10-15' }, { date: '2026-11-19' }] });
  const reprint = fair({ timing_type: 'ongoing' });
  assert.deepEqual(shownIn(seeThrough, today), ['new', 'now', 'this-month', 'this-year']);
  assert.deepEqual(shownIn(wabon, today), ['new', 'now', 'this-month', 'next-month', 'this-year']);
  assert.deepEqual(shownIn(anniversary, today), ['new', 'this-month', 'next-month', 'this-year']);
  // 通年・常設：新着以外のすべて（仕様書57章。並び順は lists で後ろに回す）
  assert.deepEqual(shownIn(reprint, today), ['now', 'this-month', 'next-month', 'this-year', 'ongoing']);
  // 定期開催も同じ
  assert.deepEqual(shownIn(fair({ timing_type: 'recurring' }), today), ['now', 'this-month', 'next-month', 'this-year', 'ongoing']);
  // 入稿日当日は「今開催中」にも出る。入稿日と入稿日の間は「今開催中」から消える
  assert.ok(inView(anniversary, 'now', '2026-10-15'));
  assert.ok(!inView(anniversary, 'now', '2026-10-16'));
  assert.ok(!inView(anniversary, 'this-month', '2026-10-16')); // 10月にはもう入稿日がない
});

test('今月・年内は「これから」だけを見る（月のはじめに終わったものは出さない）', () => {
  const endedEarly = fair({ start_date: '2026-09-01', end_date: '2026-10-03' });
  assert.deepEqual(shownIn(endedEarly, '2026-10-06'), []);
  const endsToday = fair({ start_date: '2026-09-01', end_date: '2026-10-06' });
  assert.deepEqual(shownIn(endsToday, '2026-10-06'), ['new', 'now', 'this-month', 'this-year']);
});

test('来月：来月1日〜末日と重なれば出る。開始前でも来月に始まれば出る', () => {
  const today = '2026-10-06';
  assert.ok(inView(fair({ start_date: '2026-11-30', end_date: '2026-12-31' }), 'next-month', today)); // 来月末から
  assert.ok(!inView(fair({ start_date: '2026-12-01', end_date: '2026-12-31' }), 'next-month', today)); // 再来月から
  assert.ok(inView(fair({ start_date: '2026-10-01', end_date: '2026-11-01' }), 'next-month', today)); // 来月1日まで
  assert.ok(!inView(fair({ start_date: '2026-10-01', end_date: '2026-10-31' }), 'next-month', today));
  // 12月に見た「来月」は翌年1月
  assert.ok(inView(fair({ start_date: '2027-01-10', end_date: '2027-01-20' }), 'next-month', '2026-12-15'));
});

test('終了日不明（なくなり次第終了）：今開催中・今月・年内には出し、来月には出さない', () => {
  const today = '2026-10-06';
  assert.deepEqual(shownIn(fair({ start_date: '2026-09-01', end_date_text: 'なくなり次第終了' }), today), ['new', 'now', 'this-month', 'this-year']);
  // 来月に始まる終了日不明のフェアは、開始日の来月には出る
  assert.deepEqual(shownIn(fair({ start_date: '2026-11-10' }), today), ['new', 'next-month', 'this-year']);
  // 期間がまったく不明なら時期の見方には出さない（新着には出る）
  assert.deepEqual(shownIn(fair({}), today), ['new']);
});

test('年内：今日から12月31日までの間に少なくとも1日使えるか', () => {
  assert.ok(inView(fair({ start_date: '2026-12-31', end_date: '2027-01-31' }), 'this-year', '2026-10-06'));
  assert.ok(!inView(fair({ start_date: '2027-01-01', end_date: '2027-01-31' }), 'this-year', '2026-10-06'));
});

test('viewDate：その見方で最初に使える日（並び順に使う）', () => {
  const anniversary = fair({ timing_type: 'specific_dates', submission_dates: [{ date: '2026-10-15' }, { date: '2026-11-19' }] });
  assert.equal(viewDate(anniversary, 'this-month', '2026-10-06'), '2026-10-15');
  assert.equal(viewDate(anniversary, 'next-month', '2026-10-06'), '2026-11-19');
  assert.equal(viewDate(fair({ start_date: '2026-10-01', end_date: '2026-12-31' }), 'next-month', '2026-10-06'), '2026-11-01');
  assert.equal(viewDate(anniversary, 'now', '2026-10-06'), null);
});

test('入稿日限定：状態・F・U・期限の日', () => {
  const f = fair({ timing_type: 'specific_dates', submission_dates: [{ date: '2026-10-15' }, { date: '2026-11-19' }] });
  assert.equal(getStatus(f, '2026-10-06'), 'upcoming');
  assert.equal(getStatus(f, '2026-10-15'), 'active');
  assert.equal(getStatus(f, '2026-10-16'), 'upcoming'); // 次の入稿日を待つ
  assert.equal(getStatus(f, '2026-11-20'), 'expired');
  assert.equal(effectiveFrom(f), '2026-10-15');
  assert.equal(effectiveUntil(f), '2026-11-19');
  assert.equal(deadlineDate(f, '2026-10-16'), '2026-11-19');
  assert.equal(endingLabel(f, '2026-10-15'), '本日入稿日');
  assert.equal(endingLabel(f, '2026-10-14'), '明日入稿日');
  assert.equal(endingLabel(f, '2026-10-12'), '入稿日まであと3日');
  assert.equal(endingLabel(f, '2026-10-06'), null); // 9日後
  assert.equal(cardLabel(f, '2026-11-20')?.text, '終了');
});

test('通年・常設・定期開催：常に開催中。期限・終了間近はない', () => {
  for (const timing_type of ['ongoing', 'recurring'] as const) {
    const f = fair({ timing_type });
    assert.equal(getStatus(f, '2026-10-06'), 'active');
    assert.equal(deadlineDate(f, '2026-10-06'), null);
    assert.equal(cardLabel(f, '2026-10-06'), null);
  }
  const f = fair({ timing_type: 'ongoing' });
  assert.equal(getStatus(f, '2026-10-06'), 'active');
  assert.equal(effectiveUntil(f), null);
  assert.equal(deadlineDate(f, '2026-10-06'), null);
  assert.equal(isEndingSoon(f, '2026-10-06'), false);
  assert.equal(cardLabel(f, '2026-10-06'), null);
});

test('終了間近：ラベルと境界', () => {
  const end = (end_date: string) => fair({ start_date: '2026-09-01', end_date });
  assert.equal(endingLabel(end('2026-10-04'), TODAY), '本日終了');
  assert.equal(endingLabel(end('2026-10-05'), TODAY), '明日終了');
  assert.equal(endingLabel(end('2026-10-07'), TODAY), 'あと3日');
  assert.equal(endingLabel(end('2026-10-11'), TODAY), 'あと7日');
  assert.equal(isEndingSoon(end('2026-10-12'), TODAY), false);
  assert.equal(isEndingSoon(end('2026-10-03'), TODAY), false);
  assert.equal(endingLabel(fair({ start_date: '2026-09-01' }), TODAY), null);
});

test('NEW・UPDATE：1日目から7日目まで', () => {
  const f = fair({ published_at: '2026-10-01', updated_at: '2026-10-01' });
  assert.equal(isNew(f, '2026-10-01'), true); // 1日目
  assert.equal(isNew(f, '2026-10-07'), true); // 7日目
  assert.equal(isNew(f, '2026-10-08'), false); // 8日目
  assert.equal(isUpdated(f, '2026-10-07'), true);
  assert.equal(isUpdated(f, '2026-10-08'), false);
  assert.equal(isUpdated(fair({}), TODAY), false); // 更新なし
});

test('カードの状態ラベル：1個だけ・優先順位どおり', () => {
  const label = (overrides: Partial<Fair>) => cardLabel(fair({ start_date: '2026-09-01', ...overrides }), TODAY)?.text ?? null;
  const fresh = { published_at: '2026-10-03', updated_at: '2026-10-03' }; // NEWかつUPDATE
  assert.equal(label({ ...fresh, end_date: '2026-10-04' }), '本日終了');
  assert.equal(label({ ...fresh, end_date: '2026-10-05' }), '明日終了');
  assert.equal(label({ ...fresh, end_date: '2026-10-07' }), 'あと3日');
  assert.equal(label({ ...fresh, end_date: '2026-10-08' }), 'UPDATE'); // あと4日よりUPDATE
  assert.equal(label({ published_at: '2026-10-03', end_date: '2026-10-08' }), 'NEW'); // あと4日よりNEW
  assert.equal(label({ published_at: '2026-09-01', end_date: '2026-10-11' }), 'あと7日');
  assert.equal(label({ published_at: '2026-09-01', end_date: '2026-10-12' }), null);
  assert.equal(label({ published_at: '2026-09-01' }), null); // なくなり次第終了
  assert.equal(label({ end_date: '2026-10-03' }), '終了');
});
