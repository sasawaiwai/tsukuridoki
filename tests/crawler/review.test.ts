// 確認作業（review）のテスト。apply は data/ の一時コピーの上で実際に動かす
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { buildFair, diffFields, endedPeriodChanges, isPending } from '../../crawler/review.ts';
import type { StateEntry } from '../../crawler/state.ts';

const REPO = process.cwd();
const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;

function entry(overrides: Partial<StateEntry>): StateEntry {
  return {
    url: 'https://www.eikou.com/campaign/',
    printer_id: 'eikou',
    content_hash: HASH_A,
    reviewed_hash: null,
    content_chars: 100,
    etag: null,
    last_modified: null,
    last_fetched_at: null,
    fetch_status: 'ok',
    http_status: 200,
    ...overrides,
  };
}

test('isPending：取得できていて、最後の確認から本文が変わったページだけ', () => {
  assert.equal(isPending(entry({})), true); // 未確認
  assert.equal(isPending(entry({ reviewed_hash: HASH_B })), true); // 変化あり
  assert.equal(isPending(entry({ reviewed_hash: HASH_A })), false); // 確認済み
  assert.equal(isPending(entry({ fetch_status: 'not_modified' })), true);
  assert.equal(isPending(entry({ fetch_status: 'not_found' })), false);
  assert.equal(isPending(entry({ content_hash: null, fetch_status: 'error' })), false);
});

test('buildFair：新規は運用の項目を足す。更新は変わった項目だけ履歴に残す', () => {
  const extracted = { fair_id: 'eikou-test-2026', fair_name: 'テスト', sources: ['https://www.eikou.com/campaign/'], summary: 'a', source_type: 'official_campaign' };
  const created = buildFair(extracted, 'eikou', null, '2026-10-07');
  assert.equal(created.slug, 'eikou-test-2026');
  assert.equal(created.printer_id, 'eikou');
  assert.equal(created.verification_status, 'verified');
  assert.deepEqual(created.history, [{ date: '2026-10-07', type: 'published' }]);

  const updated = buildFair({ ...extracted, summary: 'b' }, 'eikou', created, '2026-10-14');
  assert.equal(updated.summary, 'b');
  assert.equal(updated.updated_at, '2026-10-14');
  assert.equal(updated.published_at, '2026-10-07');
  assert.deepEqual((updated.history as unknown[]).at(-1), { date: '2026-10-14', type: 'updated', field: 'summary', old_value: 'a', new_value: 'b' });
  assert.deepEqual(diffFields({ ...extracted, summary: 'b' }, created), [{ field: 'summary', old: 'a', new: 'b' }]);

  const same = buildFair(extracted, 'eikou', created, '2026-10-14');
  assert.equal(same.updated_at, undefined); // 変わっていなければ更新日は付けない
  assert.equal(same.verified_at, '2026-10-14');
});

test('buildFair：変わった項目ごとに1行ずつ、変更前・変更後の値を残す', () => {
  const base = { fair_id: 'eikou-test-2026', fair_name: 'テスト', sources: ['https://www.eikou.com/campaign/'], summary: 'a', source_type: 'official_campaign' };
  const created = buildFair({ ...base, end_date: '2026-11-30' }, 'eikou', null, '2026-10-07');
  const updated = buildFair({ ...base, summary: 'b', end_date: '2026-12-15' }, 'eikou', created, '2026-10-14');
  assert.deepEqual((updated.history as unknown[]).slice(1), [
    { date: '2026-10-14', type: 'updated', field: 'summary', old_value: 'a', new_value: 'b' },
    { date: '2026-10-14', type: 'updated', field: 'end_date', old_value: '2026-11-30', new_value: '2026-12-15' },
  ]);
});

test('buildFair：訂正（corrected）と series_id は「更新されたフェア」に出さない（更新日を付けない）', () => {
  const base = { fair_id: 'eikou-test-2026', fair_name: 'テスト', sources: ['https://www.eikou.com/campaign/'], summary: 'a', source_type: 'official_campaign' };
  const created = buildFair(base, 'eikou', null, '2026-10-07');

  const corrected = buildFair({ ...base, summary: '誤字を直した' }, 'eikou', created, '2026-10-14', 'corrected');
  assert.equal(corrected.updated_at, undefined);
  assert.deepEqual((corrected.history as unknown[]).at(-1), { date: '2026-10-14', type: 'corrected', field: 'summary', old_value: 'a', new_value: '誤字を直した' });

  const series = buildFair({ ...base, series_id: 'eikou-test' }, 'eikou', created, '2026-10-14');
  assert.equal(series.series_id, 'eikou-test');
  assert.equal(series.updated_at, undefined);
  assert.deepEqual(series.history, created.history); // 履歴にも残さない
});

test('endedPeriodChanges：終了日の当日までは開催中、翌日（日本時間）から終了済みとして止める', () => {
  const existing = { fair_id: 'x', end_date: '2026-10-15', summary: 'a' };
  const extracted = { fair_id: 'x', end_date: '2026-10-31', summary: 'b' };
  assert.deepEqual(endedPeriodChanges(extracted, existing, '2026-10-15'), []); // 当日はまだ開催中
  assert.deepEqual(endedPeriodChanges(extracted, existing, '2026-10-16'), ['end_date']); // 翌日から終了済み
  assert.deepEqual(endedPeriodChanges({ fair_id: 'x', summary: 'b' }, existing, '2026-10-16'), []); // 期間以外は止めない
  assert.deepEqual(endedPeriodChanges(extracted, null, '2026-10-16'), []); // 新規
  // 判定は表示と同じく usable_until を優先する
  assert.deepEqual(endedPeriodChanges(extracted, { ...existing, usable_until: '2026-10-20' }, '2026-10-16'), []);
  // 入稿日限定は最後の入稿日の翌日から終了済み
  const dates = { fair_id: 'x', timing_type: 'specific_dates', submission_dates: [{ date: '2026-10-01' }, { date: '2026-10-15' }] };
  assert.deepEqual(endedPeriodChanges({ ...dates, submission_dates: [{ date: '2026-10-29' }] }, dates, '2026-10-16'), ['submission_dates']);
  assert.deepEqual(endedPeriodChanges({ ...dates, submission_dates: [{ date: '2026-10-29' }] }, dates, '2026-10-15'), []);
});

// ---- apply（一時コピーで実行） ----

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'tsukuridoki-review-'));
  cpSync(join(REPO, 'data'), join(dir, 'data'), { recursive: true });
  for (const name of ['schemas', 'scripts', 'src', 'crawler', 'node_modules']) symlinkSync(join(REPO, name), join(dir, name));
  // 実データの確認の進み具合に左右されないよう、対象のページを「未確認」に戻してから使う
  const statePath = join(dir, 'data/crawler/state.yaml');
  const state = parse(readFileSync(statePath, 'utf8')) as StateEntry[];
  const target = state.find((e) => e.url === 'https://www.eikou.com/campaign/')!;
  target.reviewed_hash = null;
  writeFileSync(statePath, stringify(state));
  return { dir, hash: target.content_hash! };
}

function extraction(hash: string, overrides: Record<string, unknown> = {}) {
  return {
    source_url: 'https://www.eikou.com/campaign/',
    printer_id: 'eikou',
    content_hash: hash,
    content_chars: 5527,
    extractor: 'manual',
    extracted_at: '2026-10-07T10:00:00+09:00',
    result: 'fairs',
    fairs: [
      {
        fair_id: 'eikou-review-test-2026',
        fair_name: 'テスト用フェア',
        sources: ['https://www.eikou.com/campaign/'],
        summary: 'テスト用の要約。',
        source_type: 'official_campaign',
        end_date: '2026-10-31',
        end_date_text: '10月31日まで',
        end_date_precision: 'day',
      },
    ],
    issues: ['multiple_fairs'],
    note: null,
    ...overrides,
  };
}

function run(dir: string, data: unknown, ...flags: string[]) {
  const file = join(dir, 'extraction.json');
  writeFileSync(file, JSON.stringify(data));
  return spawnSync(process.execPath, [join(dir, 'crawler/review.ts'), 'apply', file, ...flags], { cwd: dir, encoding: 'utf8' });
}

const fairFile = (dir: string) => join(dir, 'data/fairs/eikou-review-test-2026.yaml');
const reviewedHash = (dir: string) =>
  (parse(readFileSync(join(dir, 'data/crawler/state.yaml'), 'utf8')) as StateEntry[]).find((e) => e.url === 'https://www.eikou.com/campaign/')!.reviewed_hash;

test('apply：--yes なしでは書き込まず、内容だけ表示する', () => {
  const { dir, hash } = workspace();
  const r = run(dir, extraction(hash));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /新規フェア/);
  assert.match(r.stdout, /まだ書き込んでいません/);
  assert.ok(!existsSync(fairFile(dir)));
  assert.equal(reviewedHash(dir), null);
});

test('apply --yes：フェアを作り、確認済みにし、抽出結果を記録する', () => {
  const { dir, hash } = workspace();
  const r = run(dir, extraction(hash), '--yes');
  assert.equal(r.status, 0, r.stderr);
  const fair = parse(readFileSync(fairFile(dir), 'utf8'));
  assert.equal(fair.printer_id, 'eikou');
  assert.equal(fair.verification_status, 'verified');
  assert.equal(reviewedHash(dir), hash);
  // 抽出結果の記録が残っている（実データの記録とは別に、このテストのフェアを含む記録がある）
  const recordDir = join(dir, 'data/reviews/eikou');
  const recorded = readdirSync(recordDir).some((name) => readFileSync(join(recordDir, name), 'utf8').includes('eikou-review-test-2026'));
  assert.ok(recorded);
});

test('apply：確認した本文のハッシュが今の記録と違えば反映しない', () => {
  const { dir } = workspace();
  const r = run(dir, extraction(HASH_B), '--yes');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /show からやり直してください/);
  assert.ok(!existsSync(fairFile(dir)));
});

test('apply：危ないURL・ドメイン違い・運用の項目は反映しない（セキュリティ）', () => {
  const { dir, hash } = workspace();
  const base = extraction(hash).fairs[0];
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ ...base, sources: ['javascript://x.com/%0aalert(1)'] }, /使えないURL/],
    [{ ...base, sources: ['https://user:pass@www.eikou.com/'] }, /使えないURL/],
    [{ ...base, sources: ['https://evil.example/?x=eikou.com'] }, /domains/],
    [{ ...base, verification_status: 'verified' }, /書かない項目/],
    [{ ...base, fair_id: '../../escape' }, /形式が違います/],
  ];
  for (const [fair, message] of cases) {
    const r = run(dir, extraction(hash, { fairs: [fair] }), '--yes');
    assert.notEqual(r.status, 0, JSON.stringify(fair));
    assert.match(r.stderr, message);
  }
  assert.equal(reviewedHash(dir), null);
});

test('apply：既存のデータ検証が通らなければ、書いたものを元に戻す', () => {
  const { dir, hash } = workspace();
  const before = readFileSync(join(dir, 'data/crawler/state.yaml'), 'utf8');
  const records = () => (existsSync(join(dir, 'data/reviews/eikou')) ? readdirSync(join(dir, 'data/reviews/eikou')).length : 0);
  const recordsBefore = records();
  const bad = { ...extraction(hash).fairs[0], processes: ['no_such_process'] }; // 加工マスターにないID
  const r = run(dir, extraction(hash, { fairs: [bad] }), '--yes');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /元に戻しました/);
  assert.ok(!existsSync(fairFile(dir)));
  assert.equal(readFileSync(join(dir, 'data/crawler/state.yaml'), 'utf8'), before);
  assert.equal(records(), recordsBefore); // 抽出結果の記録も増えていない
});

test('apply：no_fair は確認済みにするだけ。needs_manual は確認待ちに残す', () => {
  const { dir, hash } = workspace();
  const manual = run(dir, extraction(hash, { result: 'needs_manual', fairs: [], issues: ['image_only'] }), '--yes');
  assert.equal(manual.status, 0, manual.stderr);
  assert.equal(reviewedHash(dir), null);
  const none = run(dir, extraction(hash, { result: 'no_fair', fairs: [], issues: ['not_fair'] }), '--yes');
  assert.equal(none.status, 0, none.stderr);
  assert.equal(reviewedHash(dir), hash);
  assert.ok(!existsSync(fairFile(dir)));
});

test('apply：state.yaml を書く前に止まっても、やり直せば「変更なし」で確認済みになる', () => {
  const { dir, hash } = workspace();
  const statePath = join(dir, 'data/crawler/state.yaml');
  const before = readFileSync(statePath, 'utf8');
  assert.equal(run(dir, extraction(hash), '--yes').status, 0);
  writeFileSync(statePath, before); // フェアは書けたが、state.yaml を書く前に止まった状態
  assert.equal(reviewedHash(dir), null);
  const again = run(dir, extraction(hash), '--yes');
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /変更なし/);
  assert.equal(reviewedHash(dir), hash);
  assert.ok(!readdirSync(join(dir, 'data/fairs')).some((n) => n.includes('.tmp-'))); // 一時ファイルを残さない
});

// ---- 再開催・訂正（仕様書62章） ----

/** 終了済みのフェア（2020年に終了）を1件作った状態にする */
function endedWorkspace() {
  const ws = workspace();
  const ended = { ...extraction(ws.hash).fairs[0], end_date: '2020-01-31', end_date_text: '1月31日まで' };
  assert.equal(run(ws.dir, extraction(ws.hash, { fairs: [ended] }), '--yes').status, 0);
  return { ...ws, ended };
}

test('apply：終了済みのフェアの期間は、プレビューでも反映でも止める（再開催は新しい fair_id で）', () => {
  const { dir, hash, ended } = endedWorkspace();
  const before = readFileSync(fairFile(dir), 'utf8');
  const changed = { ...ended, end_date: '2020-02-29', end_date_text: '2月29日まで' };
  for (const flags of [[], ['--yes']]) {
    const r = run(dir, extraction(hash, { fairs: [changed] }), ...flags);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /⛔ 終了済みのフェアの期間を書き換えようとしています：end_date・end_date_text/); // 内容は表示してから止める
    assert.match(r.stderr, /新しい fair_id で登録/);
  }
  assert.equal(readFileSync(fairFile(dir), 'utf8'), before);
  // 期間以外の変更は止めない
  const r = run(dir, extraction(hash, { fairs: [{ ...ended, summary: '要約を変えた。' }] }), '--yes');
  assert.equal(r.status, 0, r.stderr);
});

test('apply：--ended と --correct は指定した fair_id だけに効き、理由（note）が要る', () => {
  const { dir, hash, ended } = endedWorkspace();
  const changed = { ...ended, end_date: '2020-02-29' };
  const id = 'eikou-review-test-2026';

  // fair_id のない指定・抽出結果にない fair_id・理由なしは止める
  assert.match(run(dir, extraction(hash, { fairs: [changed], note: '訂正' }), '--ended').stderr, /fair_id を指定/);
  assert.match(run(dir, extraction(hash, { fairs: [changed], note: '訂正' }), '--ended=other-fair').stderr, /この抽出結果にありません/);
  assert.match(run(dir, extraction(hash, { fairs: [changed] }), `--ended=${id}`).stderr, /note に書いて/);

  // 同じファイルの別のフェアには広がらない（もう1件の終了済みフェアは止まる）
  const second = { ...ended, fair_id: 'eikou-review-test-2026-b', fair_name: 'テスト用フェア2' };
  assert.equal(run(dir, extraction(hash, { fairs: [ended, second] }), '--yes').status, 0);
  const both = run(dir, extraction(hash, { fairs: [changed, { ...second, end_date: '2020-02-29' }], note: '1件目の終了日の登録ミス' }), `--ended=${id}`, `--correct=${id}`, '--yes');
  assert.notEqual(both.status, 0);
  assert.match(both.stderr, /書き換えません：eikou-review-test-2026-b/);
  assert.equal(parse(readFileSync(fairFile(dir), 'utf8')).end_date, '2020-01-31'); // 1件目も書いていない

  // 必要のない指定も止める（承認した内容と実際の変更がずれないように）
  assert.match(run(dir, extraction(hash, { fairs: [ended], note: 'x' }), `--ended=${id}`).stderr, /期間の書き換えがありません/);
  assert.match(run(dir, extraction(hash, { fairs: [ended], note: 'x' }), `--correct=${id}`).stderr, /訂正する変更がありません/);
});

test('apply：終了済みのフェアの登録ミスを訂正すると、変更前・変更後が corrected で残り、更新日は付かない', () => {
  const { dir, hash, ended } = endedWorkspace();
  const id = 'eikou-review-test-2026';
  const data = extraction(hash, { fairs: [{ ...ended, end_date: '2020-02-29' }], note: '終了日の登録ミス（公式は2月29日まで）' });

  const preview = run(dir, data, `--ended=${id}`, `--correct=${id}`);
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /【訂正】/);
  assert.match(preview.stdout, /記録の種類：訂正（corrected/);
  assert.match(preview.stdout, /end_date：2020-01-31 → 2020-02-29/);
  assert.match(preview.stdout, /メモ：終了日の登録ミス/);
  assert.match(preview.stdout, /まだ書き込んでいません/);

  const r = run(dir, data, `--ended=${id}`, `--correct=${id}`, '--yes');
  assert.equal(r.status, 0, r.stderr);
  const fair = parse(readFileSync(fairFile(dir), 'utf8'));
  assert.equal(fair.end_date, '2020-02-29');
  assert.equal(fair.updated_at, undefined);
  assert.deepEqual(fair.history.at(-1), { date: fair.verified_at, type: 'corrected', field: 'end_date', old_value: '2020-01-31', new_value: '2020-02-29' });
});

test('apply：同じURLの既存フェア（確認A）・重ならない新しい期間（確認B）・前の値が残る項目（確認D）を表示する', () => {
  const { dir, hash } = workspace();
  const base = extraction(hash).fairs[0];
  const created = run(dir, extraction(hash, { fairs: [{ ...base, end_date: '2099-01-31', conditions_text: '前の回の条件' }] }), '--yes');
  assert.match(created.stdout, /同じ公式URLを使う既存のフェア/); // 栄光のキャンペーンページは既存のフェアも使っている

  const next = { ...base, start_date: '2099-03-01', end_date: '2099-03-31' };
  const r = run(dir, extraction(hash, { fairs: [next] }));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /別の回の可能性があります/);
  assert.match(r.stdout, /抽出結果にない項目（前の値が残ります）：.*conditions_text/);
  assert.match(r.stdout, /記録の種類：更新（updated/);
});
