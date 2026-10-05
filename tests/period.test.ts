import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Fair } from '../src/lib/types.ts';
import {
  addMonths,
  cardLabel,
  effectiveFrom,
  effectiveUntil,
  endingLabel,
  getStatus,
  isEndingSoon,
  isNew,
  isNextWeekend,
  isUpdated,
  isUsableAfterMonths,
  isWithin7Days,
  nextWeekend,
  todayJST,
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

test('7日以内：開始日の境界・終了日不明・終了済み', () => {
  assert.equal(isWithin7Days(fair({ start_date: '2026-10-11', end_date: '2026-12-31' }), TODAY), true); // 7日後
  assert.equal(isWithin7Days(fair({ start_date: '2026-10-12', end_date: '2026-12-31' }), TODAY), false); // 8日後
  assert.equal(isWithin7Days(fair({ start_date: '2026-09-20' }), TODAY), true); // なくなり次第終了
  assert.equal(isWithin7Days(fair({ start_date: '2026-09-01', end_date: '2026-10-03' }), TODAY), false); // 終了済み
  assert.equal(isWithin7Days(fair({ start_date: '2026-09-01', end_date: '2026-10-04' }), TODAY), true); // 本日終了
  assert.equal(isWithin7Days(fair({}), TODAY), false); // 期間不明
});

test('nか月先：終了日不明は対象外・境界', () => {
  // 1か月先の対象日は 2026-11-04
  assert.equal(isUsableAfterMonths(fair({ start_date: '2026-09-20' }), TODAY, 1), false);
  assert.equal(isUsableAfterMonths(fair({ start_date: '2026-10-01', end_date: '2026-11-04' }), TODAY, 1), true);
  assert.equal(isUsableAfterMonths(fair({ start_date: '2026-10-01', end_date: '2026-11-03' }), TODAY, 1), false);
  // 開始前でも対象日に使えれば対象
  assert.equal(isUsableAfterMonths(fair({ start_date: '2026-11-01', end_date: '2027-03-31' }), TODAY, 1), true);
  assert.equal(isUsableAfterMonths(fair({ start_date: '2026-11-05', end_date: '2027-03-31' }), TODAY, 1), false);
  // 排他的ではない：半年後まで使えるならすべてに表示
  const long = fair({ start_date: '2026-10-01', end_date: '2027-04-30' });
  for (const n of [1, 2, 3, 6]) assert.equal(isUsableAfterMonths(long, TODAY, n), true);
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

test('次の週末：曜日ごとの選び方', () => {
  assert.deepEqual(nextWeekend('2026-10-09'), { saturday: '2026-10-10', sunday: '2026-10-11' }); // 金
  assert.deepEqual(nextWeekend('2026-10-10'), { saturday: '2026-10-17', sunday: '2026-10-18' }); // 土
  assert.deepEqual(nextWeekend('2026-10-04'), { saturday: '2026-10-10', sunday: '2026-10-11' }); // 日
});

test('次の週末に間に合う：締切が明記されている場合のみ', () => {
  const base = {
    start_date: '2026-09-15',
    end_date: '2026-10-31',
    event_date: '2026-10-11',
    event_deadline: '2026-10-06',
  };
  assert.equal(isNextWeekend(fair(base), TODAY), true);
  assert.equal(isNextWeekend(fair(base), '2026-10-07'), false); // 締切を過ぎた
  assert.equal(isNextWeekend(fair({ ...base, event_deadline: null }), TODAY), false); // 締切なし
  assert.equal(isNextWeekend(fair({ ...base, event_date: '2026-10-18' }), TODAY), false); // 次の週末ではない
  assert.equal(isNextWeekend(fair({ ...base, end_date: null }), TODAY), false); // U が null
  assert.equal(isNextWeekend(fair({ ...base, end_date: '2026-10-05' }), TODAY), false); // 締切時点で終了
  assert.equal(isNextWeekend(fair({ start_date: '2026-09-01', end_date: '2026-10-31' }), TODAY), false); // 簡易判定しない
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
