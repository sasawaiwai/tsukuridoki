import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Fair, Printer } from '../src/lib/types.ts';
import { hostMatches, isSafeUrl, isSnsUrl, parseSafeUrl, sourceKind, sourceLinks } from '../src/lib/sources.ts';

function printer(overrides: Partial<Printer> = {}): Printer {
  return {
    printer_id: 'test-printer',
    name: 'テスト印刷',
    official_url: 'https://example.com/',
    domains: ['example.com', 'note.com'],
    link_policy: 'deep_link_ok',
    crawl_policy: 'unknown',
    ...overrides,
  };
}

function fair(sources: string[]): Fair {
  return {
    fair_id: 'test-fair',
    slug: 'test-fair',
    fair_name: 'テストフェア',
    printer_id: 'test-printer',
    category: 'dojinshi',
    sources,
    summary: 'テスト',
    source_type: 'official_fair',
    verification_status: 'verified',
    published_at: '2026-01-01',
  };
}

test('sourceKind：URLから種類を判定する', () => {
  const p = printer();
  assert.equal(sourceKind('https://example.com/fair/', p), 'website');
  assert.equal(sourceKind('https://shop.example.com/fair/', p), 'website');
  assert.equal(sourceKind('https://x.com/test/status/1', p), 'x');
  assert.equal(sourceKind('https://twitter.com/test/status/1', p), 'x');
  assert.equal(sourceKind('https://www.instagram.com/p/abc/', p), 'instagram');
  assert.equal(sourceKind('https://bsky.app/profile/test/post/1', p), 'bluesky');
  assert.equal(sourceKind('https://note.com/test/n/abc', p), 'other'); // domains に追加した別サイト
});

test('isSnsUrl・hostMatches：検証で使う判定', () => {
  assert.equal(isSnsUrl('https://mobile.twitter.com/test/status/1'), true);
  assert.equal(isSnsUrl('https://example.com/'), false);
  assert.equal(hostMatches('https://www.example.com/a', ['example.com']), true);
  assert.equal(hostMatches('https://example.org/a', ['example.com']), false);
});

test('sourceLinks：公式サイトがあれば公式サイトがメイン、Xは別リンク', () => {
  const { links, topPageOnly } = sourceLinks(fair(['https://x.com/t/status/1', 'https://example.com/fair/']), printer());
  assert.deepEqual(
    links.map((l) => [l.kind, l.label]),
    [
      ['website', '公式サイトでフェアの詳細を見る'],
      ['x', '公式Xでの告知を見る'],
    ],
  );
  assert.equal(topPageOnly, false);
});

test('sourceLinks：Xだけなら「公式Xでの告知を見る」がメイン。複数の投稿には番号を付ける', () => {
  const { links } = sourceLinks(fair(['https://x.com/t/status/1', 'https://x.com/t/status/2']), printer());
  assert.deepEqual(
    links.map((l) => l.label),
    ['公式Xでの告知を見る', '公式Xでの告知を見る（2）'],
  );
});

test('sourceLinks：link_policy が deep_link_ok 以外なら公式サイトは印刷所のトップへ（重複はまとめる）', () => {
  const { links, topPageOnly } = sourceLinks(
    fair(['https://example.com/fair/a', 'https://example.com/fair/b', 'https://x.com/t/status/1']),
    printer({ link_policy: 'top_page_only' }),
  );
  assert.deepEqual(
    links.map((l) => [l.href, l.label]),
    [
      ['https://example.com/', 'テスト印刷の公式サイトへ'],
      ['https://x.com/t/status/1', '公式Xでの告知を見る'],
    ],
  );
  assert.equal(topPageOnly, true);
});

test('parseSafeUrl：http・https だけを通し、ユーザー名・パスワード付きは弾く（セキュリティ）', () => {
  assert.equal(isSafeUrl('https://x.com/printer/status/1'), true);
  assert.equal(isSafeUrl('http://example.com/fair/'), true);
  for (const bad of [
    'javascript://x.com/%0aalert(1)',
    'javascript:alert(1)',
    'JAVASCRIPT://x.com/%0aalert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'https://user:pass@example.com/fair/',
    'https://user@example.com/fair/',
    '//example.com/fair/',
    'not a url',
  ]) {
    assert.equal(isSafeUrl(bad), false, bad);
    assert.equal(parseSafeUrl(bad), null, bad);
  }
});

test('isSnsUrl・hostMatches：解析したURLのホスト名だけを見る（セキュリティ）', () => {
  const p = printer();
  // ホスト名だけ見ると公式に見えるURL
  assert.equal(isSnsUrl('javascript://x.com/%0aalert(1)'), false);
  assert.equal(hostMatches('javascript://www.example.com/%0aalert(1)', p.domains), false);
  // クエリやパスに含まれるだけのドメインは、そのドメイン扱いしない
  assert.equal(isSnsUrl('https://evil.example/?x=x.com'), false);
  assert.equal(isSnsUrl('https://evil.example/x.com/status/1'), false);
  assert.equal(hostMatches('https://evil.example/?u=example.com', p.domains), false);
  assert.equal(hostMatches('https://example.com.evil.example/', p.domains), false);
  // ユーザー名にドメインを入れてだますURL
  assert.equal(hostMatches('https://example.com@evil.example/', p.domains), false);
  assert.equal(isSnsUrl('https://x.com@evil.example/'), false);
  // 正しいもの
  assert.equal(isSnsUrl('https://x.com/printer/status/1'), true);
  assert.equal(hostMatches('https://www.example.com/fair/', p.domains), true);
});

test('sourceLinks：表示の直前にも http(s) 以外を除く（二重チェック）', () => {
  const { links } = sourceLinks(fair(['javascript://x.com/%0aalert(1)', 'https://example.com/fair/']), printer());
  assert.deepEqual(links.map((l) => l.href), ['https://example.com/fair/']);
});
