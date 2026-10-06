// data/crawler/state.yaml の読み書き（仕様書7-2、phase3-design 8章）
// 保存するのは巡回の管理に必要な情報だけで、公式ページの本文は保存しない

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';
import { DATA_DIR } from '../src/lib/data.ts';
import type { FetchResult, FetchStatus } from './fetch.ts';

export const STATE_FILE = join(DATA_DIR, 'crawler', 'state.yaml');

export interface StateEntry {
  url: string;
  printer_id: string;
  content_hash: string | null;
  /** 最後に確認（抽出結果を反映）したときの本文のハッシュ。content_hash と違えば確認待ち（phase4-design 3章） */
  reviewed_hash: string | null;
  /** 取り出した本文の文字数（実測値） */
  content_chars: number | null;
  etag: string | null;
  last_modified: string | null;
  /** 最後に正常に取れた日時（ok・not_modified） */
  last_fetched_at: string | null;
  fetch_status: FetchStatus;
  http_status: number | null;
}

const HEADER = `# 巡回の記録（npm run crawl が書き換える。手で編集しない）
# URL・ハッシュ・取得日時などの管理情報だけを保存し、公式ページの本文は保存しない（仕様書7-2）
`;

/** 保存するときの項目の順番（後から足した項目が無い古い記録は null で補う） */
function ordered(e: Partial<StateEntry> & Pick<StateEntry, 'url' | 'printer_id'>): StateEntry {
  return {
    url: e.url,
    printer_id: e.printer_id,
    content_hash: e.content_hash ?? null,
    reviewed_hash: e.reviewed_hash ?? null,
    content_chars: e.content_chars ?? null,
    etag: e.etag ?? null,
    last_modified: e.last_modified ?? null,
    last_fetched_at: e.last_fetched_at ?? null,
    fetch_status: e.fetch_status ?? 'error',
    http_status: e.http_status ?? null,
  };
}

export function loadState(file = STATE_FILE): StateEntry[] {
  if (!existsSync(file)) return [];
  return ((parse(readFileSync(file, 'utf8')) as StateEntry[] | null) ?? []).map(ordered);
}

export function saveState(entries: StateEntry[], file = STATE_FILE): void {
  const sorted = entries.map(ordered).sort((a, b) => a.printer_id.localeCompare(b.printer_id) || a.url.localeCompare(b.url));
  mkdirSync(dirname(file), { recursive: true });
  // 一時ファイルに書いてから置き換える（途中で止まっても、書きかけの state.yaml を残さない）
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, HEADER + (sorted.length > 0 ? stringify(sorted, { lineWidth: 0 }) : '[]\n'));
  renameSync(tmp, file);
}

/**
 * 8-2：取得結果で記録を更新する。
 * - content_hash・content_chars・etag・last_modified：ok のときだけ（失敗しても前回のハッシュは消さない）
 * - reviewed_hash：巡回では書き換えない（確認して反映したときだけ。review apply）
 * - last_fetched_at：ok・not_modified のときだけ
 * - fetch_status・http_status：毎回
 */
export function applyResult(
  prev: StateEntry | undefined,
  base: Pick<StateEntry, 'url' | 'printer_id'>,
  result: FetchResult,
  hash: string | null,
  now: string,
  chars: number | null = null,
): StateEntry {
  const entry: StateEntry = ordered(prev ?? base);
  if (result.fetch_status === 'ok') {
    entry.content_hash = hash;
    entry.content_chars = chars;
    entry.etag = result.etag;
    entry.last_modified = result.last_modified;
  }
  if (result.fetch_status === 'ok' || result.fetch_status === 'not_modified') entry.last_fetched_at = now;
  entry.fetch_status = result.fetch_status;
  entry.http_status = result.http_status;
  return entry;
}

/** 日本時間の日時（例：2026-10-06T05:00:00+09:00） */
export function nowJst(date = new Date()): string {
  return new Date(date.getTime() + 9 * 3600_000).toISOString().replace(/\.\d{3}Z$/, '+09:00');
}
