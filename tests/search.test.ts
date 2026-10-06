import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Fair, SiteData } from '../src/lib/types.ts';
import { colorValues, matches, parseQuery, searchAttributes, toQueryString } from '../src/lib/search.ts';
import { archiveYears, attributeValues, listPages } from '../src/lib/lists.ts';

const TODAY = '2026-10-05'; // 月曜日。次の週末は 10/10・10/11

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

test('searchAttributes：時期・加工・色などの値を持つ', () => {
  const attrs = searchAttributes(
    fair({ start_date: '2026-10-01', end_date: '2026-12-31', processes: ['foil'], sizes: ['A5'], rgb_supported: true }),
    TODAY,
  );
  assert.deepEqual(attrs.period, ['now', 'this-month', 'next-month', 'this-year']);
  // 7日以内に終わるなら「終了間近」、通年・常設は通年・常設だけ
  assert.deepEqual(searchAttributes(fair({ start_date: '2026-09-01', end_date: '2026-10-08' }), TODAY).period, ['now', 'this-month', 'this-year', 'ending-soon']);
  assert.deepEqual(searchAttributes(fair({ timing_type: 'ongoing' }), TODAY).period, ['ongoing']);
  assert.deepEqual(attrs.process, ['foil']);
  assert.deepEqual(attrs.color, ['RGB']);
  assert.deepEqual(attrs.printer, ['test-printer']);
});

test('colorValues：RGB対応・特色対応のフラグも色方式に含める（重複なし）', () => {
  assert.deepEqual(colorValues(fair({ color_modes: ['RGB'], rgb_supported: true, spot_color_supported: true })), ['RGB', 'spot_color']);
});

test('parseQuery：カンマ区切りと同じキーの繰り返しの両方を読む', () => {
  const q = parseQuery(new URLSearchParams('process=pp,matte_pp&size=A6&size=A5&unknown=x&include_expired=1'));
  assert.deepEqual(q.filters, { process: ['pp', 'matte_pp'], size: ['A6', 'A5'] });
  assert.equal(q.includeExpired, true);
});

test('toQueryString：parseQuery と往復できる', () => {
  const qs = 'size=A6,A5&process=foil&include_expired=1';
  const q = parseQuery(new URLSearchParams(qs));
  assert.equal(toQueryString(q), 'process=foil&size=A6,A5&include_expired=1');
  assert.deepEqual(parseQuery(new URLSearchParams(toQueryString(q))), q);
});

test('matches：軸どうしは AND、同じ軸の中は OR', () => {
  const attrs = searchAttributes(fair({ end_date: '2026-12-31', processes: ['foil'], sizes: ['A5'] }), TODAY);
  const q = (s: string) => parseQuery(new URLSearchParams(s));
  assert.equal(matches(attrs, false, q('size=A6,A5')), true); // OR
  assert.equal(matches(attrs, false, q('size=A5&process=foil')), true); // AND
  assert.equal(matches(attrs, false, q('size=A5&process=special_paper')), false);
  assert.equal(matches(attrs, false, q('')), true);
});

test('matches：終了済みは include_expired のときだけ出す', () => {
  const attrs = searchAttributes(fair({ end_date: '2026-08-31' }), TODAY);
  assert.equal(matches(attrs, true, parseQuery(new URLSearchParams(''))), false);
  assert.equal(matches(attrs, true, parseQuery(new URLSearchParams('include_expired=1'))), true);
});

function siteData(fairs: Fair[]): SiteData {
  return {
    fairs,
    printers: [],
    papers: [],
    foils: [],
    processes: [
      { process_id: 'foil', name: '箔押し', group: 'foil_cover' },
      { process_id: 'pp', name: 'PP', group: 'surface' },
    ],
    tags: [],
  };
}

test('attributeValues：終了済みを含めてフェアがある値だけページを作る（決定事項B）', () => {
  const data = siteData([
    fair({ end_date: '2026-08-31', processes: ['foil'] }), // 終了済み
    fair({ end_date: '2026-12-31', sizes: ['A5'] }),
  ]);
  const hrefs = attributeValues(data).map((v) => v.href);
  assert.ok(hrefs.includes('/dojin/process/foil/')); // 開催中0件でもページは残る
  assert.ok(hrefs.includes('/dojin/size/A5/'));
  assert.ok(!hrefs.includes('/dojin/process/pp/')); // 一度もフェアがない値は作らない
});

test('archiveYears：終了済みフェアの終了年（新しい順）', () => {
  const fairs = [
    fair({ end_date: '2025-12-31' }),
    fair({ end_date: '2026-08-31' }),
    fair({ end_date: '2026-12-31' }), // 開催中
  ];
  assert.deepEqual(archiveYears(fairs, TODAY), ['2026', '2025']);
});

test('listPages：更新されたフェアは更新日の新しい順、終了済みは出さない', () => {
  const page = listPages(TODAY).find((p) => p.slug === 'updated')!;
  const fairs = [
    fair({ slug: 'a', end_date: '2026-12-31', updated_at: '2026-09-01' }),
    fair({ slug: 'b', end_date: '2026-12-31', updated_at: '2026-10-01' }),
    fair({ slug: 'c', end_date: '2026-08-31', updated_at: '2026-08-01' }),
    fair({ slug: 'd', end_date: '2026-12-31' }),
  ];
  assert.deepEqual(page.select(fairs).map((f) => f.slug), ['b', 'a']);
});
