// 巡回の入口（仕様書7章、phase3-design）
// 巡回は Actions で行い、結果を npm run crawl:import で取り込む（仕様書61章）
//   Actions：npm run crawl -- --out=<フォルダ>  allowed の印刷所を巡回（間隔が来ているものだけ）。state.yaml と meta.json を書き出す
// 手元での巡回は障害対応・新しい印刷所のセレクタ調整のときだけ（61-4。--local と --printer が必要）
//   npm run crawl -- --local --printer=xxx         1社だけ巡回（間隔を無視）
//   npm run crawl -- --local --printer=xxx --dry   state.yaml を書き換えずに試す
//   npm run crawl -- --local --printer=xxx --dry --max-urls=1  一覧ページだけで試す（初回の調整用）
//   npm run crawl -- --local --printer=xxx --show-text         取り出した本文と見つけたリンクを画面に出す（手元確認用。Actions では使えない）
// 結果は画面とジョブの概要欄に出す。本文はどこにも残さない（7-2）

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { readYamlDir } from '../src/lib/data.ts';
import { hostMatches } from '../src/lib/sources.ts';
import type { Printer } from '../src/lib/types.ts';
import { extract, type ExtractNote } from './extract.ts';
import { printerAccess, ROBOTS_DENIED, type AccessContext } from './access.ts';
import { Pacer, type FetchStatus } from './fetch.ts';
import { META_FILE, RESULT_STATE_FILE, type CrawlMeta } from './import.ts';
import { applyResult, loadState, nowJst, saveState, type StateEntry } from './state.ts';

/** 1回の巡回で1印刷所あたりに取得するURLの上限（4-2） */
export const MAX_URLS_PER_PRINTER = 20;

/** 10章 */
export type Outcome = '変化なし' | '変化あり' | '新規' | '要手動確認' | '失敗' | '対象外';

export interface Row {
  printer_id: string;
  url: string;
  outcome: Outcome;
  /** 文字数（取得できたときだけ） */
  chars: number | null;
  detail: string;
}

export interface CrawlContext extends AccessContext {
  now: Date;
  /** 巡回の間隔を無視する（印刷所を指定したとき） */
  force: boolean;
  /** 1社あたりに取得するURLの上限（--max-urls。MAX_URLS_PER_PRINTER を超えない） */
  maxUrls?: number;
  /** --show-text のときだけ渡す */
  onText?: (url: string, text: string) => void;
  /** --show-text のときだけ渡す。一覧ページで見つけた新規リンク */
  onLinks?: (url: string, links: string[]) => void;
}

const NOTE_LABELS: Record<ExtractNote, string> = {
  short: '短文ページ',
  short_with_images: '短文ページ（画像にも情報がある可能性）',
  js_suspect: 'JS依存の疑い',
  selector_not_found: 'crawl_selector が見つかりません（サイトの作りが変わった可能性）',
};

const STATUS_LABELS: Record<FetchStatus, string> = {
  ok: '取得',
  not_modified: '変更なし',
  not_found: 'ページなし',
  blocked: '拒否',
  error: 'エラー',
};

const DAY = 86_400_000;

/** 1社分を巡回する。state は取得結果で書き換える */
export async function crawlPrinter(printer: Printer, state: Map<string, StateEntry>, ctx: CrawlContext): Promise<Row[]> {
  const { printer_id } = printer;
  const rows: Row[] = [];
  const row = (url: string, outcome: Outcome, detail = '', chars: number | null = null) => rows.push({ printer_id, url, outcome, chars, detail });

  if (printer.crawl_policy !== 'allowed') {
    row(printer.official_url, '対象外', `crawl_policy が ${printer.crawl_policy}`);
    return rows;
  }

  const indexUrl = printer.fair_index_url ?? null;
  const known = [...state.values()].filter((e) => e.printer_id === printer_id);
  if (!indexUrl && !printer.watch_urls?.length && known.length === 0) {
    row(printer.official_url, '対象外', '巡回するURLがありません（fair_index_url・watch_urls が未設定）');
    return rows;
  }

  // 巡回の間隔：一覧ページ（無ければ記録済みのURLのうち最新）を最後に取れた日から数える（日本時間の日付で比べる）
  const lastFetched = indexUrl ? state.get(indexUrl)?.last_fetched_at : known.map((e) => e.last_fetched_at ?? '').sort().at(-1);
  const interval = printer.crawl_interval_days ?? 7;
  if (!ctx.force && lastFetched) {
    const days = (Date.parse(nowJst(ctx.now).slice(0, 10)) - Date.parse(lastFetched.slice(0, 10))) / DAY;
    if (days < interval) {
      row(printer.official_url, '対象外', `前回の巡回から${interval}日たっていません（前回：${lastFetched.slice(0, 10)}）`);
      return rows;
    }
  }

  const { denyReason, fetchAllowed } = printerAccess(printer, ctx);

  let fetched = 0;
  let stopped: string | null = null;
  const visited = new Set<string>();
  const reportedOrigins = new Set<string>();

  /** 1件取得して記録する。取れたページのリンクを返す */
  async function visit(url: string, isNewLink: boolean): Promise<string[]> {
    visited.add(url);
    const prev = state.get(url);
    const reason = await denyReason(url);
    if (reason) {
      const origin = new URL(url).origin;
      // robots.txt 自体が取れない・断られたサイトは、今回は丸ごと巡回しない（4-1）。理由はサイトごとに1回だけ出す
      if (ctx.robots.get(origin)?.kind !== 'unavailable') row(url, '対象外', reason);
      else if (!reportedOrigins.has(origin)) row(`${origin}/robots.txt`, '対象外', `${reason}。このサイトは今回巡回しません`);
      reportedOrigins.add(origin);
      if (prev && reason === ROBOTS_DENIED) state.set(url, { ...prev, fetch_status: 'blocked', http_status: null });
      return [];
    }

    // 一覧ページは「変わっていない（304）」だと中身が来ずリンクを拾えない。上限で次回に回したリンクを見つけ直すため、毎回中身を取る
    const conditional = prev?.content_hash && url !== indexUrl ? prev : {};
    const result = await fetchAllowed(url, conditional);
    fetched++;

    let hash: string | null = null;
    let chars: number | null = null;
    let links: string[] = [];
    if (result.fetch_status === 'ok') {
      const page = extract(result.html!, result.url, {
        selector: printer.crawl_selector,
        ignore: printer.crawl_ignore,
        linkSelector: url === indexUrl ? printer.fair_link_selector : null,
      });
      ctx.onText?.(url, page.text);
      hash = page.hash;
      chars = page.text.length;
      links = page.links;
      const outcome: Outcome = page.notes.includes('js_suspect')
        ? '要手動確認'
        : !prev?.content_hash
          ? '新規'
          : prev.content_hash === hash
            ? '変化なし'
            : '変化あり';
      row(url, outcome, page.notes.map((n) => NOTE_LABELS[n]).join('、'), page.text.length);
    } else if (result.fetch_status === 'not_modified') {
      row(url, '変化なし', '304（変わっていません）');
    } else {
      row(url, '失敗', `${STATUS_LABELS[result.fetch_status]}：${result.reason}`);
    }

    // 新規リンクは取れたときだけ記録する（取れなかったものは、次回また一覧ページから見つかる）
    if (!isNewLink || result.fetch_status === 'ok') {
      state.set(url, applyResult(prev, { url, printer_id }, result, hash, nowJst(ctx.now), chars));
    }
    if (result.http_status === 429 || result.http_status === 503) {
      stopped = `HTTP ${result.http_status}（混雑・拒否）のため、この印刷所の巡回を中止しました`;
    }
    return links;
  }

  // ① 一覧ページ → 新規リンクを見つける（6章）
  let newLinks: string[] = [];
  if (indexUrl) {
    const links = await visit(indexUrl, false);
    const watch = new Set(printer.watch_urls ?? []);
    // follow_links: false の印刷所は、一覧ページ（総合案内）の変化だけを見て、リンクはたどらない
    newLinks = printer.follow_links === false ? [] : links.filter((u) => u !== indexUrl && !watch.has(u) && !state.has(u) && hostMatches(u, printer.domains));
    ctx.onLinks?.(indexUrl, newLinks);
  }

  // ② 残りを優先順に：watch_urls → 新規リンク → 記録済みのURLを最後に取れた日が古い順（4-2）
  const stored = known
    .filter((e) => e.url !== indexUrl)
    .sort((a, b) => (a.last_fetched_at ?? '').localeCompare(b.last_fetched_at ?? ''))
    .map((e) => e.url);
  const newSet = new Set(newLinks);
  const maxUrls = Math.min(ctx.maxUrls ?? MAX_URLS_PER_PRINTER, MAX_URLS_PER_PRINTER);
  let left = 0;
  for (const url of [...(printer.watch_urls ?? []), ...newLinks, ...stored]) {
    if (stopped) break;
    if (visited.has(url)) continue;
    if (fetched >= maxUrls) {
      left++;
      continue;
    }
    await visit(url, newSet.has(url));
  }

  if (stopped) row(printer.official_url, '対象外', stopped);
  if (left > 0) row(printer.official_url, '対象外', `上限（${maxUrls}件）に達したため、残り${left}件は次回に回します`);
  return rows;
}

// ---- 結果の表示 ----

const ORDER: Outcome[] = ['新規', '変化あり', '要手動確認', '失敗', '変化なし', '対象外'];

function countLine(rows: Row[]): string {
  return ORDER.map((o) => `${o} ${rows.filter((r) => r.outcome === o).length}`).join(' / ');
}

function printRows(rows: Row[]): void {
  for (const r of rows) {
    const chars = r.chars === null ? '' : `（${r.chars}文字）`;
    console.log(`  ${r.outcome.padEnd(6, '　')} ${r.url}${chars}${r.detail ? `  ${r.detail}` : ''}`);
  }
}

/** Actions の巡回結果を書き出す（61-2。artifact に入れる）。本文は入れない */
export function writeResult(dir: string, entries: StateEntry[], meta: CrawlMeta): void {
  mkdirSync(dir, { recursive: true });
  saveState(entries, join(dir, RESULT_STATE_FILE));
  writeFileSync(join(dir, META_FILE), `${JSON.stringify(meta, null, 2)}\n`);
}

export function countRows(rows: Row[]): Record<string, number> {
  return Object.fromEntries(ORDER.map((o) => [o, rows.filter((r) => r.outcome === o).length]));
}

function summaryMarkdown(rows: Row[], printers: Printer[], wrote: string): string {
  const name = new Map(printers.map((p) => [p.printer_id, p.name]));
  const cell = (s: string) => s.replace(/\|/g, '\\|');
  const lines = [
    '## 巡回結果',
    '',
    countLine(rows),
    '',
    '| 印刷所 | 結果 | URL | 文字数 | メモ |',
    '|---|---|---|---|---|',
    ...rows.map((r) => `| ${cell(name.get(r.printer_id) ?? r.printer_id)} | ${r.outcome} | ${cell(r.url)} | ${r.chars ?? ''} | ${cell(r.detail)} |`),
    '',
    wrote,
    '',
  ];
  return lines.join('\n');
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      printer: { type: 'string' },
      dry: { type: 'boolean', default: false },
      'show-text': { type: 'boolean', default: false },
      'max-urls': { type: 'string' },
      local: { type: 'boolean', default: false },
      out: { type: 'string' },
    },
  });
  const inActions = process.env.GITHUB_ACTIONS === 'true';
  // 61-4：手元からの巡回は例外のときだけ。対象の印刷所だけを取得する
  if (!inActions && !values.local) {
    console.error('巡回は GitHub Actions で行います（仕様書61章）。Actions 画面の「Crawl」で実行し、npm run crawl:import で取り込んでください。\n障害対応・新しい印刷所のセレクタ調整のときだけ、--local --printer=<印刷所ID> を付けて手元で実行できます');
    process.exit(1);
  }
  if (!inActions && !values.printer) {
    console.error('手元での巡回は1社ずつです。--printer=<印刷所ID> を指定してください（仕様書61-4）');
    process.exit(1);
  }
  if (inActions && !values.dry && !values.out) {
    console.error('Actions では --out=<フォルダ> を指定してください（巡回結果を artifact に置くため。仕様書61-2）');
    process.exit(1);
  }
  const baseCommit = process.env.BASE_COMMIT ?? '';
  if (inActions && values.out && !/^[0-9a-f]{40}$/.test(baseCommit)) {
    console.error('BASE_COMMIT（巡回の元にした develop のコミット）が渡されていません');
    process.exit(1);
  }
  const startedAt = nowJst();
  const maxUrls = values['max-urls'] === undefined ? undefined : Number(values['max-urls']);
  if (maxUrls !== undefined && !(Number.isInteger(maxUrls) && maxUrls >= 1)) {
    console.error('--max-urls には1以上の整数を指定してください');
    process.exit(1);
  }
  if (inActions && values['show-text']) {
    console.error('--show-text は Actions では使えません（公開リポジトリのログに本文が残るため）');
    process.exit(1);
  }

  const printers = readYamlDir<Printer>('printers').map((f) => f.data);
  const targets = values.printer ? printers.filter((p) => p.printer_id === values.printer) : printers;
  if (targets.length === 0) {
    console.error(`印刷所「${values.printer}」が data/printers/ にありません`);
    process.exit(1);
  }

  const loaded = loadState();
  const state = new Map(loaded.map((e) => [e.url, e]));
  const ctx: CrawlContext = {
    pacer: new Pacer(),
    robots: new Map(),
    now: new Date(),
    force: Boolean(values.printer),
    maxUrls,
    onText: values['show-text'] ? (url, text) => console.log(`\n----- ${url} -----\n${text}\n-----\n`) : undefined,
    onLinks: values['show-text'] ? (url, links) => console.log(`\n----- ${url} の新規リンク（${links.length}件） -----\n${links.join('\n')}\n-----\n`) : undefined,
  };

  const rows: Row[] = [];
  for (const printer of targets) {
    console.log(`▶ ${printer.name}`);
    const result = await crawlPrinter(printer, state, ctx);
    printRows(result);
    rows.push(...result);
  }

  // Actions ではリポジトリの state.yaml を書き換えず、巡回結果を --out に書き出す（artifact にして手元で取り込む。61-2・61-3）
  // 手元では、何も取得しなかったとき（全社が対象外など）は書き換えない
  let message: string;
  if (inActions && values.out && !values.dry) {
    const meta: CrawlMeta = {
      run_id: process.env.GITHUB_RUN_ID ?? '',
      run_attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      base_commit: baseCommit,
      event: process.env.GITHUB_EVENT_NAME ?? null,
      target: { printer: values.printer ?? null, max_urls: maxUrls ?? null },
      outcome: rows.some((r) => r.outcome === '失敗') ? '一部失敗' : '成功',
      counts: countRows(rows),
      started_at: startedAt,
      finished_at: nowJst(),
    };
    writeResult(values.out, [...state.values()], meta);
    message = '巡回結果を artifact に置きました（手元で npm run crawl:import で取り込む）';
  } else {
    const changed = JSON.stringify([...state.values()]) !== JSON.stringify(loaded);
    const write = changed && !values.dry && !inActions;
    if (write) saveState([...state.values()]);
    message = write ? 'data/crawler/state.yaml を更新しました' : 'state.yaml は書き換えていません';
  }
  console.log(`\n${countLine(rows)}\n${message}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown(rows, printers, message));
}

if (import.meta.main) await main();
