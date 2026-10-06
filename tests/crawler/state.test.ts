import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FetchResult } from '../../crawler/fetch.ts';
import { applyResult, loadState, nowJst, saveState, type StateEntry } from '../../crawler/state.ts';

const base = { url: 'https://example.com/fair/', printer_id: 'example' };
const NOW = '2026-10-06T05:00:00+09:00';
const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;

const prev: StateEntry = {
  ...base,
  content_hash: HASH_A,
  etag: '"v1"',
  last_modified: 'Mon, 05 Oct 2026 00:00:00 GMT',
  last_fetched_at: '2026-09-29T05:00:00+09:00',
  fetch_status: 'ok',
  http_status: 200,
};

function result(overrides: Partial<FetchResult>): FetchResult {
  return { fetch_status: 'ok', http_status: 200, url: base.url, html: '', etag: null, last_modified: null, reason: null, ...overrides };
}

test('applyResult：取れたらハッシュ・ETag・取得日時を更新する', () => {
  const e = applyResult(prev, base, result({ etag: '"v2"' }), HASH_B, NOW);
  assert.equal(e.content_hash, HASH_B);
  assert.equal(e.etag, '"v2"');
  assert.equal(e.last_fetched_at, NOW);
  assert.equal(e.fetch_status, 'ok');
});

test('applyResult：304 なら取得日時だけ更新し、ハッシュ・ETag は残す', () => {
  const e = applyResult(prev, base, result({ fetch_status: 'not_modified', http_status: 304 }), null, NOW);
  assert.equal(e.content_hash, HASH_A);
  assert.equal(e.etag, '"v1"');
  assert.equal(e.last_fetched_at, NOW);
  assert.equal(e.fetch_status, 'not_modified');
});

test('applyResult：失敗しても前回のハッシュと取得日時を消さない', () => {
  for (const [fetch_status, http_status] of [['not_found', 404], ['blocked', 403], ['error', null]] as const) {
    const e = applyResult(prev, base, result({ fetch_status, http_status }), null, NOW);
    assert.equal(e.content_hash, HASH_A);
    assert.equal(e.last_fetched_at, prev.last_fetched_at);
    assert.equal(e.fetch_status, fetch_status);
    assert.equal(e.http_status, http_status);
  }
});

test('applyResult：初めてのURL', () => {
  assert.deepEqual(applyResult(undefined, base, result({ etag: '"v1"' }), HASH_A, NOW), {
    ...base,
    content_hash: HASH_A,
    etag: '"v1"',
    last_modified: null,
    last_fetched_at: NOW,
    fetch_status: 'ok',
    http_status: 200,
  });
});

test('saveState / loadState：印刷所・URL順で保存し、読み戻せる', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'tsukuridoki-')), 'crawler', 'state.yaml');
  const b = { ...prev, url: 'https://example.com/b/' };
  const a = { ...prev, url: 'https://example.com/a/' };
  const other = { ...prev, printer_id: 'aaa', url: 'https://example.net/' };
  saveState([b, a, other], file);
  assert.deepEqual(loadState(file).map((e) => e.url), [other.url, a.url, b.url]);
  assert.match(readFileSync(file, 'utf8'), /^# 巡回の記録/);
  assert.equal(typeof loadState(file)[0].last_fetched_at, 'string'); // 日時が Date に変わらない
});

test('nowJst：日本時間の日時', () => {
  assert.equal(nowJst(new Date('2026-10-05T20:00:00Z')), '2026-10-06T05:00:00+09:00');
});
