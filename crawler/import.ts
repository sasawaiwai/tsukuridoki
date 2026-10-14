// Actions の巡回結果を手元の state.yaml に取り込む（仕様書61-3）
//   npm run crawl:import                    成功した最新の実行を選び、実行の情報と取り込む内容を表示（書き込まない）
//   npm run crawl:import -- --yes           取り込む
//   npm run crawl:import -- --run=<実行ID>   実行を指定する
// 元（base_commit の state.yaml）・手元・Actions の3つを URL ごとに比べ、Actions が元から変えたURLだけを反映する。
// reviewed_hash は手元の値を残す。競合・不整合があれば何も書き換えずに止める

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import { loadState, parseState, saveState, type StateEntry } from './state.ts';

export const ARTIFACT_NAME = 'crawl-result';
export const META_FILE = 'meta.json';
export const RESULT_STATE_FILE = 'state.yaml';

/** artifact に入れる実行の情報（61-2） */
export interface CrawlMeta {
  run_id: string;
  run_attempt: string | null;
  /** 巡回の元にした develop のコミット */
  base_commit: string;
  /** schedule（定期）・workflow_dispatch（手動） */
  event: string | null;
  /** 巡回対象。printer が null なら間隔が来ている全社 */
  target: { printer: string | null; max_urls: number | null };
  outcome: '成功' | '一部失敗';
  counts: Record<string, number>;
  started_at: string;
  finished_at: string;
}

/** 巡回が書き換える項目（applyResult）。printer_id も Actions で変わってはいけないので比べる */
const CRAWL_FIELDS = ['printer_id', 'content_hash', 'content_chars', 'etag', 'last_modified', 'last_fetched_at', 'fetch_status', 'http_status'] as const;

const crawlPart = (e: StateEntry) => JSON.stringify(CRAWL_FIELDS.map((f) => e[f]));
const sameCrawl = (a: StateEntry, b: StateEntry) => crawlPart(a) === crawlPart(b);

export interface MergeResult {
  merged: StateEntry[];
  updated: string[];
  added: string[];
  conflicts: { url: string; reason: string }[];
}

/** 3つの記録を URL ごとに比べる。conflicts が1件でもあれば merged を使ってはいけない */
export function mergeState(base: StateEntry[], local: StateEntry[], actions: StateEntry[]): MergeResult {
  const B = new Map(base.map((e) => [e.url, e]));
  const L = new Map(local.map((e) => [e.url, e]));
  const A = new Map(actions.map((e) => [e.url, e]));
  const result: MergeResult = { merged: [], updated: [], added: [], conflicts: [] };
  const conflict = (url: string, reason: string) => result.conflicts.push({ url, reason });

  // 巡回は記録を消さないので、元にあったURLは Actions にもあるはず
  for (const url of B.keys()) if (!A.has(url)) conflict(url, '元の記録にあるURLが、Actions の記録にありません');

  const next = new Map(L);
  for (const [url, a] of A) {
    const b = B.get(url);
    const l = L.get(url);
    if (!b) {
      // Actions が新しく見つけたURL
      if (a.reviewed_hash !== null) conflict(url, 'Actions で新しく見つけたURLに reviewed_hash が入っています');
      else if (!l) {
        next.set(url, a);
        result.added.push(url);
      } else if (!sameCrawl(a, l)) conflict(url, '手元にも同じURLが別の内容で追加されています');
      continue;
    }
    if (a.reviewed_hash !== b.reviewed_hash) {
      conflict(url, 'Actions の記録で reviewed_hash が変わっています');
      continue;
    }
    if (a.printer_id !== b.printer_id) {
      conflict(url, 'Actions の記録で印刷所が変わっています');
      continue;
    }
    if (sameCrawl(a, b)) continue; // Actions は変えていない（巡回の対象外など）→ 手元のまま
    if (!l) {
      conflict(url, 'Actions が更新したURLを、手元で削除しています');
      continue;
    }
    if (sameCrawl(l, a)) continue; // 同じ結果を取り込み済み
    if (!sameCrawl(l, b)) {
      conflict(url, 'Actions が更新したURLを、手元でも元から変えています（手元で巡回した・別の結果を取り込み済み）');
      continue;
    }
    next.set(url, { ...a, reviewed_hash: l.reviewed_hash });
    result.updated.push(url);
  }
  result.merged = [...next.values()];
  return result;
}

/** 実行の情報が、取り込もうとしている実行のものとして正しいか。だめなら理由を返す */
export function checkMeta(meta: unknown, runId: string): string | null {
  const m = meta as Partial<CrawlMeta> | null;
  if (!m || typeof m !== 'object') return `${META_FILE} が読めません`;
  if (String(m.run_id) !== runId) return `${META_FILE} の実行ID（${m.run_id}）が、指定した実行（${runId}）と違います`;
  if (typeof m.base_commit !== 'string' || !/^[0-9a-f]{40}$/.test(m.base_commit)) return `${META_FILE} に元のコミットがありません`;
  if (!m.target || typeof m.target !== 'object') return `${META_FILE} に巡回対象がありません`;
  if (m.outcome !== '成功' && m.outcome !== '一部失敗') return `${META_FILE} の実行結果が読めません`;
  return null;
}

export function describeTarget(target: CrawlMeta['target']): string {
  const who = target.printer ? `印刷所 ${target.printer}（間隔を無視）` : '全社（間隔が来ている印刷所）';
  return target.max_urls ? `${who}・1社あたり${target.max_urls}件まで（一部だけの巡回）` : who;
}

// ---- CLI ----

class ImportFailure extends Error {}

/** 止める（finally で一時フォルダを消せるよう、process.exit ではなく例外で抜ける） */
function fail(message: string): never {
  throw new ImportFailure(message);
}

function run(cmd: string, args: string[]): { ok: boolean; out: string; err: string } {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.error) fail(`${cmd} を実行できません（${r.error.message}）`);
  return { ok: r.status === 0, out: r.stdout, err: r.stderr.trim() };
}

function latestSuccessfulRun(): string {
  const r = run('gh', ['run', 'list', '--workflow', 'crawl.yml', '--status', 'success', '--limit', '1', '--json', 'databaseId']);
  if (!r.ok) fail(`実行の一覧を取れません：${r.err}`);
  const runs = JSON.parse(r.out) as { databaseId: number }[];
  if (runs.length === 0) fail('成功した巡回の実行がありません');
  return String(runs[0].databaseId);
}

function baseState(commit: string): StateEntry[] {
  if (!run('git', ['cat-file', '-e', `${commit}^{commit}`]).ok) fail(`元のコミット ${commit.slice(0, 7)} が手元にありません。git fetch origin develop をしてから、やり直してください`);
  const r = run('git', ['show', `${commit}:data/crawler/state.yaml`]);
  return r.ok ? parseState(r.out) : []; // 元のコミットに state.yaml が無ければ空
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { run: { type: 'string' }, yes: { type: 'boolean', default: false } } });
  if (values.run !== undefined && !/^\d+$/.test(values.run)) fail('--run には実行ID（数字）を指定してください');
  const runId = values.run ?? latestSuccessfulRun();

  const dir = mkdtempSync(join(tmpdir(), 'tsukuridoki-crawl-'));
  try {
    const dl = run('gh', ['run', 'download', runId, '--name', ARTIFACT_NAME, '--dir', dir]);
    if (!dl.ok) fail(`実行 ${runId} の巡回結果を取れません（巡回結果は14日で消えます。仕組みを入れる前の実行には巡回結果がありません）：${dl.err}`);
    if (!existsSync(join(dir, META_FILE)) || !existsSync(join(dir, RESULT_STATE_FILE))) fail(`巡回結果に ${META_FILE} か ${RESULT_STATE_FILE} がありません`);

    let meta: unknown;
    try {
      meta = JSON.parse(readFileSync(join(dir, META_FILE), 'utf8'));
    } catch {
      fail(`${META_FILE} が読めません`);
    }
    const metaError = checkMeta(meta, runId);
    if (metaError) fail(metaError);
    const m = meta as CrawlMeta;

    const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
    addFormats(ajv);
    const validate = ajv.compile(JSON.parse(readFileSync(join(process.cwd(), 'schemas', 'crawler-state.schema.json'), 'utf8')));
    const raw = readFileSync(join(dir, RESULT_STATE_FILE), 'utf8');
    if (!validate(parse(raw) ?? [])) fail(`巡回結果の state.yaml が正しい形式ではありません：${ajv.errorsText(validate.errors)}`);

    console.log(`\n実行ID：${m.run_id}${m.run_attempt && m.run_attempt !== '1' ? `（${m.run_attempt}回目）` : ''}　きっかけ：${m.event === 'schedule' ? '定期' : m.event === 'workflow_dispatch' ? '手動' : m.event ?? '不明'}`);
    console.log(`巡回：${m.started_at} 〜 ${m.finished_at}`);
    console.log(`元のコミット：${m.base_commit.slice(0, 7)}`);
    console.log(`巡回対象：${describeTarget(m.target)}`);
    console.log(`実行結果：${m.outcome}　${Object.entries(m.counts ?? {}).map(([k, v]) => `${k} ${v}`).join(' / ')}`);

    const { merged, updated, added, conflicts } = mergeState(baseState(m.base_commit), loadState(), parseState(raw));
    if (conflicts.length > 0) {
      for (const c of conflicts) console.error(`  ${c.url}\n    ${c.reason}`);
      fail(`競合・不整合が${conflicts.length}件あるため、取り込みません（state.yaml は書き換えていません）`);
    }

    console.log(`\n取り込む内容：更新 ${updated.length}件 / 追加 ${added.length}件（ほかのURLは手元のまま。reviewed_hash は手元の値を残す）`);
    for (const url of updated) console.log(`  更新 ${url}`);
    for (const url of added) console.log(`  追加 ${url}`);
    if (updated.length === 0 && added.length === 0) {
      console.log('\n取り込むものはありません（state.yaml は書き換えていません）\n');
      return;
    }
    if (!values.yes) {
      console.log('\nまだ書き込んでいません。内容がよければ --yes を付けて実行してください\n');
      return;
    }
    saveState(merged);
    console.log('\ndata/crawler/state.yaml を更新しました。npm run validate のあと、develop にコミットして push してください\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (e) {
    if (!(e instanceof ImportFailure)) throw e;
    console.error(`\n❌ ${e.message}\n`);
    process.exitCode = 1;
  }
}
