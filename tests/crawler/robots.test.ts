// robots-parser は最終更新が古いため、RFC 9309 の代表的なケースと Crawl-delay の読み取りをここで確かめる（phase3-design 4-1）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretRobots } from '../../crawler/robots.ts';

const ROBOTS = 'https://example.com/robots.txt';
const url = (path: string) => `https://example.com${path}`;

function rules(body: string) {
  const robots = interpretRobots(ROBOTS, 200, body);
  assert.equal(robots.kind, 'rules');
  return robots as Extract<typeof robots, { kind: 'rules' }>;
}

test('RFC 9309：自分宛てのグループがあれば、それだけを使う（* とは合わせない）', () => {
  const r = rules(`User-agent: *\nDisallow: /\n\nUser-agent: TsukuridokiBot\nDisallow: /private/\n`);
  assert.equal(r.isAllowed(url('/fair/')), true);
  assert.equal(r.isAllowed(url('/private/a')), false);
});

test('RFC 9309：自分宛てが無ければ * を使う', () => {
  const r = rules(`User-agent: OtherBot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin/\n`);
  assert.equal(r.isAllowed(url('/fair/')), true);
  assert.equal(r.isAllowed(url('/admin/')), false);
});

test('RFC 9309：User-agent の名前は大文字・小文字を区別しない', () => {
  assert.equal(rules(`User-agent: tsukuridokibot\nDisallow: /\n`).isAllowed(url('/')), false);
});

test('RFC 9309：1つのグループに複数の User-agent を書ける', () => {
  const r = rules(`User-agent: OtherBot\nUser-agent: TsukuridokiBot\nDisallow: /x/\n`);
  assert.equal(r.isAllowed(url('/x/1')), false);
});

test('RFC 9309：Allow と Disallow が重なるときは長い方が優先、同じ長さなら Allow', () => {
  const r = rules(`User-agent: *\nDisallow: /fair/\nAllow: /fair/open/\nDisallow: /same\nAllow: /same\n`);
  assert.equal(r.isAllowed(url('/fair/closed')), false);
  assert.equal(r.isAllowed(url('/fair/open/1')), true);
  assert.equal(r.isAllowed(url('/same')), true);
});

test('RFC 9309：* と $ の書き方', () => {
  const r = rules(`User-agent: *\nDisallow: /*.php$\nDisallow: /tmp*/cache\n`);
  assert.equal(r.isAllowed(url('/index.php')), false);
  assert.equal(r.isAllowed(url('/index.php?x=1')), true);
  assert.equal(r.isAllowed(url('/tmp1/cache')), false);
});

test('RFC 9309：空の Disallow は「制限なし」', () => {
  assert.equal(rules(`User-agent: *\nDisallow:\n`).isAllowed(url('/anything')), true);
});

test('Crawl-delay（RFC 外）：max(5秒, Crawl-delay) にする', () => {
  assert.equal(rules(`User-agent: *\nCrawl-delay: 10\n`).delayMs, 10_000);
  assert.equal(rules(`User-agent: *\nCrawl-delay: 1\n`).delayMs, 5000);
  assert.equal(rules(`User-agent: *\nDisallow:\n`).delayMs, 5000);
  // 自分宛てのグループの Crawl-delay を使う
  assert.equal(rules(`User-agent: *\nCrawl-delay: 30\n\nUser-agent: TsukuridokiBot\nCrawl-delay: 8\n`).delayMs, 8000);
});

test('応答ごとの扱い：404・410 は制限なし', () => {
  for (const status of [404, 410]) {
    const r = interpretRobots(ROBOTS, status, '');
    assert.equal(r.kind, 'rules');
    if (r.kind === 'rules') assert.equal(r.isAllowed(url('/')), true);
  }
});

test('応答ごとの扱い：401・403・429・5xx・通信エラーは巡回しない', () => {
  for (const status of [401, 403, 429, 500, 503, 400]) {
    assert.equal(interpretRobots(ROBOTS, status, '').kind, 'unavailable', String(status));
  }
  const r = interpretRobots(ROBOTS, null, '', 'タイムアウト（20秒）');
  assert.equal(r.kind, 'unavailable');
  if (r.kind === 'unavailable') assert.match(r.reason, /タイムアウト/);
});
