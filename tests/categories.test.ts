import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Fair } from '../src/lib/types.ts';
import { FAIR_CATEGORIES, groupByCategory, OTHER_CATEGORY } from '../src/lib/categories.ts';
import { listPages } from '../src/lib/lists.ts';
import { TAB_VIEWS, LIST_PAGES } from '../src/lib/nav.ts';

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

const keysOf = (fairs: Fair[]) => groupByCategory(fairs, (f) => f.fair_id).map((g) => [g.category.key, g.items]);

test('複数のカテゴリに当たるフェアは、当たるカテゴリすべてに出る（元データは1件のまま）', () => {
  // 特殊紙表紙＋箔押し20%OFF → 箔押し・特殊紙・割引
  const f = fair('foil-paper', { processes: ['foil', 'special_paper'], benefit_types: ['discount'] });
  assert.deepEqual(keysOf([f]), [
    ['foil', ['foil-paper']],
    ['special-paper', ['foil-paper']],
    ['discount', ['foil-paper']],
  ]);
});

test('同じカテゴリの中で同じフェアは1回だけ（同じフェアを2回渡しても）', () => {
  const f = fair('a', { processes: ['foil', 'emboss', 'deboss'] });
  const groups = groupByCategory([f, f], (x) => x.fair_id);
  assert.deepEqual(groups.map((g) => [g.category.key, g.items]), [['foil', ['a']]]);
});

test('箔押しには空押し・エンボス・デボスも入る', () => {
  for (const p of ['foil', 'blind_emboss', 'emboss', 'deboss']) {
    assert.deepEqual(keysOf([fair('x', { processes: [p] })])[0][0], 'foil');
  }
});

test('特色・カラー・RGB印刷：特色印刷・本文色刷りで判定し、RGB入稿の対応だけでは入れない', () => {
  assert.equal(keysOf([fair('spot', { processes: ['spot_color_printing'] })])[0][0], 'color-printing');
  assert.equal(keysOf([fair('body', { processes: ['color_body'] })])[0][0], 'color-printing');
  // RGBも入稿できる箔押しのフェア → 箔押しだけ
  const rgbOnly = fair('rgb', { processes: ['foil'], color_modes: ['CMYK', 'RGB'], rgb_supported: true, spot_color_supported: true });
  assert.deepEqual(keysOf([rgbOnly]).map(([k]) => k), ['foil']);
});

test('加工無料は独立したカテゴリ（加工のカテゴリとの両方に出る）', () => {
  const f = fair('free-foil', { processes: ['foil'], benefit_types: ['free_process'] });
  assert.deepEqual(keysOf([f]).map(([k]) => k), ['foil', 'free-process']);
});

test('「その他」には、どのカテゴリにも当たらないフェアだけが入る', () => {
  const none = fair('none', {});
  const tagsOnly = fair('tags', { tags: ['seasonal'], sizes: ['A5'], color_modes: ['RGB'] }); // 分類に使わない項目だけ
  const foil = fair('foil', { processes: ['foil'] });
  assert.deepEqual(keysOf([none, tagsOnly, foil]), [
    ['foil', ['foil']],
    ['other', ['none', 'tags']],
  ]);
  assert.equal(OTHER_CATEGORY.match(foil), false);
});

test('0件のカテゴリは出さない・カテゴリの順番は定義の順・その他は最後', () => {
  const fairs = [fair('d', { benefit_types: ['discount'] }), fair('n', {}), fair('p', { processes: ['pp'] })];
  assert.deepEqual(keysOf(fairs).map(([k]) => k), ['pp', 'discount', 'other']);
  assert.deepEqual(groupByCategory([], (f) => f), []);
  // 定義のキーは重複しない（アンカーに使うため）
  const keys = [...FAIR_CATEGORIES, OTHER_CATEGORY].map((c) => c.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('カテゴリの中の並びは、渡したタブの並び順のまま', () => {
  const today = '2026-10-07';
  const fairs = [
    fair('late', { start_date: '2026-10-01', end_date: '2026-12-31', processes: ['foil'] }),
    fair('soon', { start_date: '2026-10-01', end_date: '2026-10-10', processes: ['foil'] }),
    fair('always', { timing_type: 'ongoing', processes: ['foil'] }),
  ];
  const now = listPages(today).find((p) => p.slug === 'now')!.select(fairs);
  const groups = groupByCategory(now, (f) => f.fair_id);
  assert.deepEqual(groups[0].items, now.map((f) => f.fair_id));
  assert.deepEqual(groups[0].items, ['soon', 'late', 'always']);
});

test('総件数は重複なし、カテゴリ別の件数の合計はそれ以上になりうる', () => {
  const fairs = [fair('a', { processes: ['foil'], benefit_types: ['discount'] }), fair('b', { benefit_types: ['discount'] })];
  const groups = groupByCategory(fairs, (f) => f);
  const sum = groups.reduce((n, g) => n + g.items.length, 0);
  assert.equal(new Set(groups.flatMap((g) => g.items.map((f) => f.fair_id))).size, fairs.length);
  assert.equal(sum, 3);
});

test('トップのタブ：開催中が最初（初期表示）、新着が2番目。表示名は「開催中」', () => {
  assert.deepEqual([...TAB_VIEWS], ['now', 'new', 'this-month', 'next-month', 'this-year', 'ongoing']);
  assert.equal(LIST_PAGES.now.label, '開催中');
  assert.equal(listPages('2026-10-07').find((p) => p.slug === 'now')!.title, '開催中のフェア');
});
