import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Fair, Process } from '../src/lib/types.ts';
import { benefitText, cardCategory, deadlineText, processMap, toCardModel } from '../src/lib/fair-display.ts';

const processes = processMap([
  { process_id: 'foil', name: '箔押し', group: 'foil_cover' },
  { process_id: 'special_paper', name: '特殊紙', group: 'other' },
  { process_id: 'matte_pp', name: 'マットPP', group: 'surface' },
  { process_id: 'edge_printing', name: '小口印刷', group: 'edge' },
  { process_id: 'endpaper', name: '遊び紙', group: 'other' },
  { process_id: 'color_body', name: '本文色刷り', group: 'body' },
] satisfies Process[]);

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

test('カード上部の色：決まった順で最初に当てはまるもの', () => {
  assert.equal(cardCategory(fair({ processes: ['special_paper', 'foil'] }), processes), 'foil');
  assert.equal(cardCategory(fair({ processes: ['matte_pp'], papers: { mode: 'all_special_papers' } }), processes), 'paper');
  assert.equal(cardCategory(fair({ processes: ['matte_pp'], color_modes: ['RGB'] }), processes), 'rgb');
  assert.equal(cardCategory(fair({ processes: ['matte_pp', 'endpaper'] }), processes), 'surface');
  assert.equal(cardCategory(fair({ processes: ['edge_printing'] }), processes), 'craft');
  assert.equal(cardCategory(fair({ processes: ['color_body'], benefit_types: ['discount'] }), processes), 'deal');
  assert.equal(cardCategory(fair({ benefit_types: ['novelty'] }), processes), 'other');
});

test('特典文：benefit_summary を優先し、なければ自動生成', () => {
  assert.equal(benefitText(fair({ benefit_summary: '箔押し料金30%OFF', benefit_types: ['discount'] }), processes), '箔押し料金30%OFF');
  assert.equal(benefitText(fair({ processes: ['foil'], benefit_types: ['discount'], discount_rate: 50 }), processes), '箔押し 50%OFF');
  assert.equal(benefitText(fair({ benefit_types: ['discount'], discount_amount: 3000 }), processes), '3,000円引き');
  assert.equal(benefitText(fair({ processes: ['edge_printing'], benefit_types: ['free_process'] }), processes), '小口印刷無料');
  assert.equal(benefitText(fair({ benefit_types: ['free_paper_upgrade', 'novelty'] }), processes), '用紙変更無料／ノベルティ付き');
  assert.equal(benefitText(fair({ benefit_types: ['free_option'], free_options: ['RGB表紙印刷'] }), processes), 'RGB表紙印刷無料');
  assert.equal(benefitText(fair({}), processes), '');
});

test('期限表示：開催前・原文・日付のみ・不明・終了', () => {
  const today = '2026-10-04';
  assert.equal(deadlineText(fair({ start_date: '2026-10-09', end_date: '2026-12-31' }), today), '10月9日から利用可能');
  assert.equal(deadlineText(fair({ end_date: '2026-11-30', end_date_text: '11月末まで', usable_until_text: '11月25日入稿分まで' }), today), '11月25日入稿分まで');
  assert.equal(deadlineText(fair({ end_date: '2026-11-30' }), today), '11月30日まで');
  assert.equal(deadlineText(fair({ start_date: '2026-09-01' }), today), '終了日未定'); // 終了日が決まっていない
  assert.equal(deadlineText(fair({ start_date: '2026-09-01', end_date_text: 'なくなり次第終了' }), today), 'なくなり次第終了');
  assert.equal(deadlineText(fair({}), today), '期間未定');
  assert.equal(deadlineText(fair({ end_date: '2026-10-01' }), today), '終了しました');
});

test('期限表示：入稿日限定は過ぎた日を出さない、多ければ「ほか」。通年・常設', () => {
  const dates = (...d: string[]) => fair({ timing_type: 'specific_dates', submission_dates: d.map((date) => ({ date })) });
  assert.equal(deadlineText(dates('2026-10-15', '2026-11-19'), '2026-10-06'), '入稿日限定：10月15日・11月19日');
  assert.equal(deadlineText(dates('2026-10-15', '2026-11-19'), '2026-10-16'), '入稿日限定：11月19日');
  assert.equal(deadlineText(dates('2026-10-15', '2026-11-19'), '2026-11-20'), '終了しました');
  assert.equal(deadlineText(dates('2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22'), '2026-09-30'), '入稿日限定：10月1日・10月8日・10月15日ほか');
  assert.equal(deadlineText(fair({ timing_type: 'ongoing' }), '2026-10-06'), '通年・常設');
});

test('チップ：最大5個、残りは件数で返す', () => {
  const model = toCardModel(
    fair({ processes: ['foil', 'special_paper'], sizes: ['A6', 'A5', 'B5'], printing_methods: ['ondemand'], color_modes: ['RGB', 'CMYK'] }),
    { printerName: 'テスト印刷', processes, today: '2026-10-04' },
  );
  assert.deepEqual(model.chips.map((c) => c.label), ['箔押し', '特殊紙', 'A6', 'A5', 'B5']);
  assert.equal(model.hiddenChipCount, 2); // オンデマンド・RGB対応（CMYKは表示しない）
  assert.equal(model.chips[0].category, 'foil');
  assert.equal(model.href, '/dojin/fairs/test-fair/');
});
