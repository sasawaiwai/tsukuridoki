// Actions の巡回結果の取り込み（仕様書61章）。外部のサイト・GitHub にはつながない
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeResult } from '../../crawler/crawl.ts';
import { checkMeta, mergeState, type CrawlMeta } from '../../crawler/import.ts';
import { loadState, type StateEntry } from '../../crawler/state.ts';

const H = (c: string) => `sha256:${c.repeat(64)}`;

const entry = (url: string, over: Partial<StateEntry> = {}): StateEntry => ({
  url,
  printer_id: 'example',
  content_hash: H('a'),
  reviewed_hash: H('a'),
  content_chars: 1000,
  etag: null,
  last_modified: null,
  last_fetched_at: '2026-10-05T05:00:00+09:00',
  fetch_status: 'ok',
  http_status: 200,
  ...over,
});

const U1 = 'https://example.com/fair/';
const U2 = 'https://example.com/fair/2/';
const U3 = 'https://example.com/fair/3/';
const crawled = { content_hash: H('b'), content_chars: 1200, last_fetched_at: '2026-10-12T05:00:00+09:00' };

const byUrl = (entries: StateEntry[]) => new Map(entries.map((e) => [e.url, e]));

test('mergeState：Actions が変えたURLだけ反映し、reviewed_hash は手元の値を残す', () => {
  const base = [entry(U1), entry(U2)];
  // 手元では巡回のあとに U1 を確認済みにした（reviewed_hash だけ変わる）
  const local = [entry(U1, { reviewed_hash: H('c') }), entry(U2)];
  const actions = [entry(U1, crawled), entry(U2)];
  const r = mergeState(base, local, actions);
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(r.updated, [U1]);
  const m = byUrl(r.merged);
  assert.equal(m.get(U1)?.content_hash, H('b'));
  assert.equal(m.get(U1)?.reviewed_hash, H('c'));
  assert.deepEqual(m.get(U2), entry(U2));
});

test('mergeState：一部だけ巡回した結果でも、巡回の対象外の記録は手元のまま（消えない・戻らない）', () => {
  const base = [entry(U1), entry(U2), entry(U3, { printer_id: 'other' })];
  // 手元では、元のあとに U2 を別の結果で更新済み
  const local = [entry(U1), entry(U2, { content_hash: H('d') }), entry(U3, { printer_id: 'other' })];
  // Actions は U1 だけ巡回した（--printer・--max-urls=1）
  const actions = [entry(U1, crawled), entry(U2), entry(U3, { printer_id: 'other' })];
  const r = mergeState(base, local, actions);
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(r.updated, [U1]);
  const m = byUrl(r.merged);
  assert.equal(r.merged.length, 3);
  assert.equal(m.get(U2)?.content_hash, H('d'));
  assert.deepEqual(m.get(U3), entry(U3, { printer_id: 'other' }));
});

test('mergeState：新しく見つけたURLは追加する。手元で削除し Actions が触っていないURLは削除のまま', () => {
  const base = [entry(U1), entry(U2)];
  const local = [entry(U1)];
  const actions = [entry(U1), entry(U2), entry(U3, { reviewed_hash: null })];
  const r = mergeState(base, local, actions);
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(r.added, [U3]);
  assert.deepEqual([...byUrl(r.merged).keys()].sort(), [U1, U3]);
});

test('mergeState：同じ結果を2回取り込んでも変わらない', () => {
  const base = [entry(U1)];
  const actions = [entry(U1, crawled), entry(U2, { reviewed_hash: null })];
  const first = mergeState(base, [entry(U1)], actions);
  const second = mergeState(base, first.merged, actions);
  assert.deepEqual(second.conflicts, []);
  assert.deepEqual(second.updated, []);
  assert.deepEqual(second.added, []);
  assert.deepEqual(second.merged, first.merged);
});

test('mergeState：手元でも元から別の値に変えていたら競合（手元で巡回した・古い結果を後から取り込む）', () => {
  const base = [entry(U1)];
  const local = [entry(U1, { content_hash: H('d') })];
  const actions = [entry(U1, crawled)];
  const r = mergeState(base, local, actions);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].url, U1);
});

test('mergeState：Actions が更新したURLを手元で削除していたら競合', () => {
  const r = mergeState([entry(U1), entry(U2)], [entry(U2)], [entry(U1, crawled), entry(U2)]);
  assert.deepEqual(r.conflicts.map((c) => c.url), [U1]);
});

test('mergeState：本来起こらない不整合は競合（元のURLが無い・reviewed_hash や印刷所が変わった・新規URLに reviewed_hash）', () => {
  assert.equal(mergeState([entry(U1)], [entry(U1)], []).conflicts.length, 1);
  assert.equal(mergeState([entry(U1)], [entry(U1)], [entry(U1, { reviewed_hash: H('e') })]).conflicts.length, 1);
  assert.equal(mergeState([entry(U1)], [entry(U1)], [entry(U1, { printer_id: 'other' })]).conflicts.length, 1);
  assert.equal(mergeState([], [], [entry(U1)]).conflicts.length, 1);
});

test('mergeState：手元にも同じURLが追加されていたら、内容が同じときだけそのまま', () => {
  const same = mergeState([], [entry(U1, { reviewed_hash: null })], [entry(U1, { reviewed_hash: null })]);
  assert.deepEqual(same.conflicts, []);
  assert.deepEqual(same.added, []);
  const diff = mergeState([], [entry(U1, { reviewed_hash: null })], [entry(U1, { ...crawled, reviewed_hash: null })]);
  assert.equal(diff.conflicts.length, 1);
});

const meta: CrawlMeta = {
  run_id: '123',
  run_attempt: '1',
  base_commit: 'f'.repeat(40),
  event: 'workflow_dispatch',
  target: { printer: 'example', max_urls: 1 },
  outcome: '成功',
  counts: { 新規: 0 },
  started_at: '2026-10-14T03:43:00+09:00',
  finished_at: '2026-10-14T03:50:00+09:00',
};

test('checkMeta：実行IDの取り違え・元のコミットや実行結果の欠けを見つける', () => {
  assert.equal(checkMeta(meta, '123'), null);
  assert.match(checkMeta(meta, '456') ?? '', /実行ID/);
  assert.match(checkMeta({ ...meta, base_commit: 'abc' }, '123') ?? '', /元のコミット/);
  assert.match(checkMeta({ ...meta, outcome: '不明' }, '123') ?? '', /実行結果/);
  assert.match(checkMeta(null, '123') ?? '', /読めません/);
});

test('writeResult：state.yaml と meta.json だけを書き出し、読み戻せる', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'crawl-result-')), 'crawl-result');
  writeResult(dir, [entry(U1)], meta);
  assert.deepEqual(loadState(join(dir, 'state.yaml')), [entry(U1)]);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')), meta);
});

// 止める判定は取得の前にあるので、外部にはつながない
const crawlCli = (args: string[], env: Record<string, string>) =>
  spawnSync(process.execPath, ['crawler/crawl.ts', ...args], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '', GITHUB_STEP_SUMMARY: '', ...env } });

test('npm run crawl：手元では --local がないと止める', () => {
  const r = crawlCli(['--printer=example'], {});
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--local/);
});

test('npm run crawl：手元では --printer がないと止める（全社を巡回しない）', () => {
  const r = crawlCli(['--local'], {});
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--printer/);
});

test('npm run crawl：Actions では --out（--dry 以外）と元のコミットがないと止める', () => {
  assert.match(crawlCli([], { GITHUB_ACTIONS: 'true' }).stderr, /--out/);
  assert.match(crawlCli(['--out=x'], { GITHUB_ACTIONS: 'true', BASE_COMMIT: '' }).stderr, /BASE_COMMIT/);
});
