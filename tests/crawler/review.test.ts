// 確認作業（review）のテスト。apply は data/ の一時コピーの上で実際に動かす
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { buildFair, diffFields, isPending } from '../../crawler/review.ts';
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
  assert.deepEqual((updated.history as unknown[]).at(-1), { date: '2026-10-14', type: 'updated', field: 'summary' });
  assert.deepEqual(diffFields({ ...extracted, summary: 'b' }, created), [{ field: 'summary', old: 'a', new: 'b' }]);

  const same = buildFair(extracted, 'eikou', created, '2026-10-14');
  assert.equal(same.updated_at, undefined); // 変わっていなければ更新日は付けない
  assert.equal(same.verified_at, '2026-10-14');
});

// ---- apply（一時コピーで実行） ----

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'tsukuridoki-review-'));
  cpSync(join(REPO, 'data'), join(dir, 'data'), { recursive: true });
  for (const name of ['schemas', 'scripts', 'src', 'crawler', 'node_modules']) symlinkSync(join(REPO, name), join(dir, name));
  const state = parse(readFileSync(join(dir, 'data/crawler/state.yaml'), 'utf8')) as StateEntry[];
  const target = state.find((e) => e.url === 'https://www.eikou.com/campaign/')!;
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
  assert.equal(readdirSync(join(dir, 'data/reviews/eikou')).length, 1);
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
  const bad = { ...extraction(hash).fairs[0], processes: ['no_such_process'] }; // 加工マスターにないID
  const r = run(dir, extraction(hash, { fairs: [bad] }), '--yes');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /元に戻しました/);
  assert.ok(!existsSync(fairFile(dir)));
  assert.equal(readFileSync(join(dir, 'data/crawler/state.yaml'), 'utf8'), before);
  assert.ok(!existsSync(join(dir, 'data/reviews')) || readdirSync(join(dir, 'data/reviews/eikou')).length === 0);
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
