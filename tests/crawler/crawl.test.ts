// 手元で立てたテスト用サーバー（127.0.0.1）で、取得と巡回の流れを確かめる。外部のサイトにはつながない
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Printer } from '../../src/lib/types.ts';
import { crawlPrinter, MAX_URLS_PER_PRINTER, type CrawlContext, type Row } from '../../crawler/crawl.ts';
import { decodeHtml, fetchPage, MAX_BYTES } from '../../crawler/fetch.ts';
import type { StateEntry } from '../../crawler/state.ts';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
let routes: Record<string, Handler> = {};
let origin = '';
const server = createServer((req, res) => {
  const handler = routes[req.url ?? ''];
  if (handler) handler(req, res);
  else res.writeHead(404).end();
});

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());
beforeEach(() => {
  routes = {};
});

const filler = '本文の説明。'.repeat(40);
const html = (body: string, headers: Record<string, string> = {}): Handler => (_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...headers }).end(`<html><body>${body}</body></html>`);
};
const status = (code: number, headers: Record<string, string> = {}): Handler => (_req, res) => res.writeHead(code, headers).end();
const allowAll = async () => null;

// ---- 取得（fetch.ts） ----

test('decodeHtml：応答ヘッダー → <meta charset> の順で文字コードを判定する', () => {
  const sjis = Buffer.from([0x83, 0x74, 0x83, 0x46, 0x83, 0x41]); // 「フェア」（Shift_JIS）
  assert.equal(decodeHtml(sjis, 'text/html; charset=Shift_JIS'), 'フェア');
  const withMeta = Buffer.concat([Buffer.from('<meta http-equiv="Content-Type" content="text/html; charset=shift_jis">'), sjis]);
  assert.match(decodeHtml(withMeta, 'text/html'), /フェア$/);
  assert.equal(decodeHtml(Buffer.from('フェア'), 'text/html; charset=unknown-code'), 'フェア');
});

test('fetchPage：HTMLだけを取る', async () => {
  routes['/a.pdf'] = (_req, res) => res.writeHead(200, { 'Content-Type': 'application/pdf' }).end('%PDF');
  const r = await fetchPage(`${origin}/a.pdf`, {}, allowAll);
  assert.equal(r.fetch_status, 'error');
  assert.match(r.reason ?? '', /HTMLではありません/);
});

test('fetchPage：2MBを超えたら途中でやめる', async () => {
  routes['/big'] = (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' }); // Content-Length なし
    res.end('a'.repeat(MAX_BYTES + 1));
  };
  const r = await fetchPage(`${origin}/big`, {}, allowAll);
  assert.equal(r.fetch_status, 'error');
  assert.match(r.reason ?? '', /2MB/);
});

test('fetchPage：リダイレクトは5回まで。移動先が取得禁止なら取らない', async () => {
  for (let i = 0; i < 7; i++) routes[`/r${i}`] = status(302, { Location: `/r${i + 1}` });
  routes['/r7'] = html('着いた');
  assert.match((await fetchPage(`${origin}/r0`, {}, allowAll)).reason ?? '', /5回/);
  routes['/r5'] = html('着いた');
  const ok = await fetchPage(`${origin}/r0`, {}, allowAll);
  assert.equal(ok.fetch_status, 'ok');
  assert.equal(ok.url, `${origin}/r5`);
  const denied = await fetchPage(`${origin}/r0`, {}, async (u) => (u.endsWith('/r2') ? 'domains の外です' : null));
  assert.equal(denied.fetch_status, 'error');
  assert.equal(denied.reason, 'domains の外です');
});

test('fetchPage：ETag を送り、304 なら本文を取らない', async () => {
  routes['/e'] = (req, res) => {
    if (req.headers['if-none-match'] === '"v1"') res.writeHead(304).end();
    else res.writeHead(200, { 'Content-Type': 'text/html', ETag: '"v1"' }).end('<p>本文</p>');
  };
  const first = await fetchPage(`${origin}/e`, {}, allowAll);
  assert.equal(first.etag, '"v1"');
  const second = await fetchPage(`${origin}/e`, { etag: first.etag }, allowAll);
  assert.equal(second.fetch_status, 'not_modified');
  assert.equal(second.html, null);
});

test('fetchPage：応答の番号で fetch_status を分ける', async () => {
  const cases = [[404, 'not_found'], [410, 'not_found'], [403, 'blocked'], [429, 'blocked'], [500, 'error']] as const;
  for (const [code, expected] of cases) {
    routes[`/s${code}`] = status(code);
    const r = await fetchPage(`${origin}/s${code}`, {}, allowAll);
    assert.equal(r.fetch_status, expected, String(code));
    assert.equal(r.http_status, code);
  }
});

// ---- 巡回の流れ（crawl.ts） ----

function printer(overrides: Partial<Printer> = {}): Printer {
  return {
    printer_id: 'local',
    name: 'テスト印刷',
    official_url: `${origin}/`,
    fair_index_url: `${origin}/fair/`,
    domains: ['127.0.0.1'],
    link_policy: 'deep_link_ok',
    crawl_policy: 'allowed',
    fair_link_selector: '.fair-list a',
    ...overrides,
  };
}

function context(overrides: Partial<CrawlContext> = {}): CrawlContext {
  return {
    pacer: { wait: async () => {}, done: () => {} }, // テストでは待たない
    robots: new Map(),
    now: new Date('2026-10-06T00:00:00Z'),
    force: true,
    ...overrides,
  };
}

const outcomes = (rows: Row[]) => Object.fromEntries(rows.map((r) => [r.url.replace(origin, ''), r.outcome]));

function fairSite() {
  routes['/robots.txt'] = status(404);
  routes['/fair/'] = html(`<main><ul class="fair-list"><li><a href="/fair/1/">1</a></li><li><a href="/fair/2/?utm_source=x">2</a></li></ul>
    <a href="/price/">料金表</a><p>${filler}</p></main>`);
  routes['/fair/1/'] = html(`<main><p>フェア1 締切11/30</p><p>${filler}</p></main>`);
  routes['/fair/2/'] = html(`<main><p>フェア2</p><p>${filler}</p></main>`);
}

test('crawlPrinter：初回は新規、2回目は変化なし、内容が変われば変化あり', async () => {
  fairSite();
  const state = new Map<string, StateEntry>();
  const first = await crawlPrinter(printer(), state, context());
  assert.deepEqual(outcomes(first), { '/fair/': '新規', '/fair/1/': '新規', '/fair/2/': '新規' }); // 料金表は拾わない
  assert.deepEqual([...state.keys()].map((u) => u.replace(origin, '')), ['/fair/', '/fair/1/', '/fair/2/']);

  const second = await crawlPrinter(printer(), state, context());
  assert.deepEqual(outcomes(second), { '/fair/': '変化なし', '/fair/1/': '変化なし', '/fair/2/': '変化なし' });

  routes['/fair/1/'] = html(`<main><p>フェア1 締切12/15</p><p>${filler}</p></main>`);
  routes['/fair/2/'] = status(404);
  const third = await crawlPrinter(printer(), state, context());
  assert.equal(outcomes(third)['/fair/1/'], '変化あり');
  assert.equal(outcomes(third)['/fair/2/'], '失敗');
  const gone = state.get(`${origin}/fair/2/`)!;
  assert.equal(gone.fetch_status, 'not_found');
  assert.equal(gone.http_status, 404);
  assert.match(gone.content_hash ?? '', /^sha256:/); // 前回のハッシュは残る
});

test('crawlPrinter：取れなかった新規リンクは記録しない', async () => {
  fairSite();
  routes['/fair/2/'] = status(500);
  const state = new Map<string, StateEntry>();
  await crawlPrinter(printer(), state, context());
  assert.ok(!state.has(`${origin}/fair/2/`));
});

test('crawlPrinter：1社20URLまで。優先順は 一覧 → watch_urls → 新規リンク → 記録済みの古い順', async () => {
  routes['/robots.txt'] = status(404);
  const items = Array.from({ length: 25 }, (_, i) => `<li><a href="/fair/${i}/">${i}</a></li>`).join('');
  routes['/fair/'] = html(`<main><ul class="fair-list">${items}</ul><p>${filler}</p></main>`);
  routes['/watch/'] = html(`<main><p>${filler}</p></main>`);
  for (let i = 0; i < 25; i++) routes[`/fair/${i}/`] = html(`<main><p>フェア${i}</p><p>${filler}</p></main>`);
  routes['/old/'] = html(`<main><p>${filler}</p></main>`);

  const old: StateEntry = {
    url: `${origin}/old/`, printer_id: 'local', content_hash: null, etag: null, last_modified: null,
    last_fetched_at: '2026-09-01T05:00:00+09:00', fetch_status: 'ok', http_status: 200,
  };
  const state = new Map([[old.url, old]]);
  const rows = await crawlPrinter(printer({ watch_urls: [`${origin}/watch/`] }), state, context());
  const fetched = rows.filter((r) => r.outcome !== '対象外').map((r) => r.url.replace(origin, ''));
  assert.equal(fetched.length, MAX_URLS_PER_PRINTER);
  assert.deepEqual(fetched.slice(0, 3), ['/fair/', '/watch/', '/fair/0/']);
  assert.ok(!fetched.includes('/old/')); // 新規リンクが先
  assert.match(rows.at(-1)!.detail, /残り8件は次回/); // 新規 7件＋記録済み 1件

  // 次回：入りきらなかった新規リンクは、また一覧から見つかる。その後に記録済みの古いURL（ハッシュ未記録なので新規扱い）
  const next = await crawlPrinter(printer({ watch_urls: [`${origin}/watch/`] }), state, context());
  const nextNew = next.filter((r) => r.outcome === '新規').map((r) => r.url.replace(origin, ''));
  assert.deepEqual(nextNew, ['/fair/18/', '/fair/19/', '/fair/20/', '/fair/21/', '/fair/22/', '/fair/23/', '/fair/24/', '/old/']);
});

test('crawlPrinter：robots.txt で禁止されたURLは取らない', async () => {
  fairSite();
  routes['/robots.txt'] = (_req, res) => res.writeHead(200, { 'Content-Type': 'text/plain' }).end('User-agent: *\nDisallow: /fair/2/\n');
  const state = new Map<string, StateEntry>();
  const rows = await crawlPrinter(printer(), state, context());
  assert.equal(outcomes(rows)['/fair/2/'], '対象外');
  assert.ok(!state.has(`${origin}/fair/2/`));
});

test('crawlPrinter：robots.txt が取れない（503）サイトは巡回しない', async () => {
  fairSite();
  routes['/robots.txt'] = status(503);
  let pageRequests = 0;
  const page = routes['/fair/'];
  routes['/fair/'] = (req, res) => {
    pageRequests++;
    page(req, res);
  };
  const state = new Map<string, StateEntry>();
  const rows = await crawlPrinter(printer(), state, context());
  assert.equal(pageRequests, 0);
  assert.equal(state.size, 0);
  assert.equal(rows.length, 1);
  assert.match(rows[0].detail, /robots\.txt.*HTTP 503.*今回巡回しません/);
});

test('crawlPrinter：429 が返ったら、その印刷所の巡回を中止する', async () => {
  fairSite();
  routes['/fair/1/'] = status(429);
  const rows = await crawlPrinter(printer(), new Map(), context());
  assert.ok(!('/fair/2/' in outcomes(rows)));
  assert.match(rows.at(-1)!.detail, /HTTP 429.*中止/);
});

test('crawlPrinter：crawl_policy が allowed でなければ何もしない', async () => {
  let requests = 0;
  routes['/robots.txt'] = (_req, res) => {
    requests++;
    res.writeHead(404).end();
  };
  for (const crawl_policy of ['unknown', 'manual_only', 'forbidden'] as const) {
    const rows = await crawlPrinter(printer({ crawl_policy }), new Map(), context());
    assert.equal(rows[0].outcome, '対象外');
  }
  assert.equal(requests, 0);
});

test('crawlPrinter：間隔（crawl_interval_days）が来ていなければ飛ばす。印刷所を指定したときは飛ばさない', async () => {
  fairSite();
  const state = new Map<string, StateEntry>();
  await crawlPrinter(printer(), state, context({ now: new Date('2026-09-30T00:00:00Z') })); // 9/30 に取得
  const sixDays = await crawlPrinter(printer(), state, context({ force: false, now: new Date('2026-10-06T00:00:00Z') }));
  assert.match(sixDays[0].detail, /7日たっていません/);
  // 7日後なら、前回より早い時刻でも巡回する（日付で比べる）
  const sevenDays = await crawlPrinter(printer(), state, context({ force: false, now: new Date('2026-10-06T20:00:00Z') }));
  assert.equal(sevenDays[0].outcome, '変化なし');
});

test('crawlPrinter：JS依存の疑いは「要手動確認」', async () => {
  routes['/robots.txt'] = status(404);
  routes['/fair/'] = html('<div id="root"></div><script src="/app.js"></script>');
  const rows = await crawlPrinter(printer(), new Map(), context());
  assert.equal(rows[0].outcome, '要手動確認');
  assert.match(rows[0].detail, /JS依存/);
});

test('crawlPrinter：maxUrls（--max-urls）で取得数を減らせる。20件は超えない', async () => {
  fairSite();
  const rows = await crawlPrinter(printer(), new Map(), context({ maxUrls: 1 }));
  assert.deepEqual(rows.filter((r) => r.outcome !== '対象外').map((r) => r.url.replace(origin, '')), ['/fair/']);
  assert.match(rows.at(-1)!.detail, /上限（1件）.*残り2件/);
});

test('crawlPrinter：一覧ページは304で返されないよう毎回中身を取り、次回に回したリンクを見つけ直す', async () => {
  fairSite();
  const index = routes['/fair/'];
  routes['/fair/'] = (req, res) => {
    if (req.headers['if-none-match']) res.writeHead(304).end();
    else {
      res.setHeader('ETag', '"index"');
      index(req, res);
    }
  };
  const state = new Map<string, StateEntry>();
  await crawlPrinter(printer(), state, context({ maxUrls: 2 }));
  assert.ok(!state.has(`${origin}/fair/2/`)); // 上限で次回に回った
  const next = await crawlPrinter(printer(), state, context({ maxUrls: 2 }));
  assert.equal(outcomes(next)['/fair/'], '変化なし');
  assert.equal(outcomes(next)['/fair/2/'], '新規');
});

test('crawlPrinter：follow_links が false なら、一覧ページのリンクをたどらない', async () => {
  fairSite();
  const state = new Map<string, StateEntry>();
  const rows = await crawlPrinter(printer({ follow_links: false }), state, context());
  assert.deepEqual(Object.keys(outcomes(rows)), ['/fair/']);
  assert.deepEqual([...state.keys()].map((u) => u.replace(origin, '')), ['/fair/']);
});
