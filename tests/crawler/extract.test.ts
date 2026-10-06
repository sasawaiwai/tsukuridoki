import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract, hashText, normalizeText, normalizeUrl } from '../../crawler/extract.ts';

const PAGE = 'https://example.com/fair/index.html';
const filler = '本文の説明。'.repeat(40); // 200文字を超える本文

test('extract：header・nav・footer・script などを除き、main を本文にする', () => {
  const html = `<html><body>
    <header>サイト名</header><nav>メニュー</nav>
    <main><h1>秋の箔押しフェア</h1><p>期間：10/1〜10/31</p><p>${filler}</p><script>var x=1</script></main>
    <aside>人気記事</aside><footer>© 印刷所</footer>
  </body></html>`;
  const { text } = extract(html, PAGE);
  assert.match(text, /^秋の箔押しフェア\n期間:10\/1〜10\/31\n/);
  for (const word of ['サイト名', 'メニュー', '人気記事', '© 印刷所', 'var x']) assert.ok(!text.includes(word), word);
});

test('extract：ブロック要素・br の区切りで改行し、文字がくっつかない', () => {
  const { text } = extract('<body><div>本文20%OFF</div><div>対象セット<br>はこちら</div></body>', PAGE);
  assert.equal(text, '本文20%OFF\n対象セット\nはこちら');
});

test('extract：crawl_selector と crawl_ignore', () => {
  const html = `<body><div id="side">関係ない</div><div id="content"><p>フェア本文</p><span class="counter">12345</span></div></body>`;
  const { text, notes } = extract(html, PAGE, { selector: '#content', ignore: ['.counter'] });
  assert.equal(text, 'フェア本文');
  assert.ok(!notes.includes('selector_not_found'));
});

test('extract：crawl_selector が見つからないときは main → body に戻して注意を付ける', () => {
  const { text, notes } = extract('<body><p>本文</p></body>', PAGE, { selector: '#gone' });
  assert.equal(text, '本文');
  assert.ok(notes.includes('selector_not_found'));
});

test('extract：毎回変わる部分を取り除けば、同じハッシュになる', () => {
  const page = (count: number) => `<body><main><p>フェア本文</p><p class="counter">${count}</p></main></body>`;
  const a = extract(page(1), PAGE, { ignore: ['.counter'] });
  const b = extract(page(2), PAGE, { ignore: ['.counter'] });
  assert.equal(a.hash, b.hash);
  assert.notEqual(extract(page(1), PAGE).hash, extract(page(2), PAGE).hash);
});

test('extract：日付が変わればハッシュも変わる（日付を消さない）', () => {
  const a = extract('<main><p>締切：11/30</p></main>', PAGE);
  const b = extract('<main><p>締切：12/15</p></main>', PAGE);
  assert.notEqual(a.hash, b.hash);
});

test('normalizeText：全角英数・半角カナ・空白・改行をそろえる', () => {
  assert.equal(normalizeText('  ＡＢＣ１２３　ﾌｪｱ \r\n\r\n\n  本文   です  '), 'ABC123 フェア\n本文 です');
});

test('hashText：sha256: から始まる64桁', () => {
  assert.match(hashText('テスト'), /^sha256:[0-9a-f]{64}$/);
});

test('extract：短文ページは「注意」だけで、JS依存の疑いにはしない', () => {
  assert.deepEqual(extract('<main><p>10/1〜10/31 本文20%OFF</p></main>', PAGE).notes, ['short']);
  assert.deepEqual(extract('<main><p>フェア開催中</p><img src="banner.png"></main>', PAGE).notes, ['short_with_images']);
  assert.deepEqual(extract(`<main><p>${filler}</p><img src="a.png"></main>`, PAGE).notes, []);
});

test('extract：JS依存の疑い（空の描画先・noscript の文言・script ばかり）', () => {
  assert.deepEqual(extract('<body><div id="root"></div><script src="app.js"></script></body>', PAGE).notes, ['js_suspect']);
  assert.deepEqual(extract('<body><noscript>JavaScriptを有効にしてください</noscript><p>読み込み中</p></body>', PAGE).notes, ['js_suspect']);
  assert.deepEqual(extract('<body><script></script><script></script><script></script><p>…</p></body>', PAGE).notes, ['js_suspect']);
  // 本文が十分あれば、描画先があっても疑わない
  assert.deepEqual(extract(`<body><div id="app"></div><main><p>${filler}</p></main></body>`, PAGE).notes, []);
});

test('extract：リンクは本文の場所から集め、絶対URLにそろえる', () => {
  const html = `<body><nav><a href="/company/">会社概要</a></nav>
    <main><a href="a.html">A</a><a href="a.html#detail">A again</a><a href="/files/guide.pdf">PDF</a>
    <a href="mailto:info@example.com">mail</a><a href="https://other.example.org/x">外部</a></main></body>`;
  const { links } = extract(html, PAGE);
  assert.deepEqual(links, ['https://example.com/fair/a.html', 'https://other.example.org/x']);
});

test('extract：fair_link_selector があれば、その場所のリンクだけを見る', () => {
  const html = `<body><main>
    <ul class="fair-list"><li><a href="/fair/1/">フェア1</a></li><li><a href="/fair/2/">フェア2</a></li></ul>
    <p><a href="/price/">料金表</a><a href="/guide/">入稿案内</a></p></main></body>`;
  const { links } = extract(html, PAGE, { linkSelector: '.fair-list a' });
  assert.deepEqual(links, ['https://example.com/fair/1/', 'https://example.com/fair/2/']);
  // 要素（ul）を指定しても、その中のリンクを見る
  assert.deepEqual(extract(html, PAGE, { linkSelector: '.fair-list' }).links, links);
});

test('extract：<base href> があれば、それを基準にする', () => {
  const { links } = extract('<head><base href="https://example.com/campaign/"></head><body><a href="x.html">x</a></body>', PAGE);
  assert.deepEqual(links, ['https://example.com/campaign/x.html']);
});

test('normalizeUrl：# 以降と追跡用パラメータを取り、それ以外は残す', () => {
  assert.equal(normalizeUrl('/fair/?id=12&utm_source=x&UTM_medium=y&fbclid=abc#top', PAGE), 'https://example.com/fair/?id=12');
  assert.equal(normalizeUrl('https://Example.COM:443/Fair/', PAGE), 'https://example.com/Fair/');
  assert.equal(normalizeUrl('/a?q=a%20b', PAGE), 'https://example.com/a?q=a%20b'); // 書き直さない
  assert.equal(normalizeUrl('/fair', PAGE), 'https://example.com/fair'); // 末尾の / は足さない
  assert.equal(normalizeUrl('javascript:void(0)', PAGE), null);
  assert.equal(normalizeUrl('tel:0000', PAGE), null);
});
