import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Fair } from '../src/lib/types.ts';
import { byRankThenPublished, listPages } from '../src/lib/lists.ts';

function fair(fair_id: string, overrides: Partial<Fair>): Fair {
  return {
    fair_id,
    slug: fair_id,
    fair_name: fair_id,
    printer_id: 'test-printer',
    category: 'dojinshi',
    sources: ['https://example.com/'],
    summary: 'テスト',
    source_type: 'official_fair',
    verification_status: 'verified',
    published_at: '2026-10-01',
    ...overrides,
  };
}

const TODAY = '2026-10-07';
const fairs = [
  fair('always-ongoing', { timing_type: 'ongoing', published_at: '2026-10-07' }),
  fair('always-recurring', { timing_type: 'recurring', published_at: '2026-10-06' }),
  fair('period-late', { start_date: '2026-10-01', end_date: '2026-12-31' }),
  fair('period-soon', { start_date: '2026-10-01', end_date: '2026-10-10' }),
  fair('dates', { timing_type: 'specific_dates', submission_dates: [{ date: '2026-10-15' }] }),
];
const select = (slug: string) =>
  listPages(TODAY)
    .find((p) => p.slug === slug)!
    .select(fairs)
    .map((f) => f.fair_id);

test('期間のタブ：①日付あり → ②定期開催 → ③通年・常設 の順（仕様書57章）', () => {
  // 日付ありの中は、その見方で最初に使える日 → 終わりが近い順
  assert.deepEqual(select('this-month'), ['period-soon', 'period-late', 'dates', 'always-recurring', 'always-ongoing']);
  assert.deepEqual(select('now'), ['period-soon', 'period-late', 'always-recurring', 'always-ongoing']);
});

test('新着：通年・常設・定期開催は出さない', () => {
  assert.deepEqual(select('new'), ['period-late', 'period-soon', 'dates']);
});

test('通年・常設タブ：定期開催 → 通年・常設', () => {
  assert.deepEqual(select('ongoing'), ['always-recurring', 'always-ongoing']);
});

test('印刷所別・属性別の並び：いつでも使えるフェアは掲載日が新しくても後ろ', () => {
  assert.deepEqual([...fairs].sort(byRankThenPublished).map((f) => f.fair_id), ['period-late', 'period-soon', 'dates', 'always-recurring', 'always-ongoing']);
});
