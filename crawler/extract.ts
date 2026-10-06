// 本文の取り出し・正規化・ハッシュ・リンク抽出（仕様書7-1、phase3-design 5〜7章）
// 取り出した本文はメモリ上で扱うだけで、ファイルやログには出さない（7-2）

import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';

/** 本文として扱わない要素（5-1） */
const REMOVE = 'script, style, noscript, template, header, footer, nav, aside, form, iframe, svg';
/** 文字を取り出すとき、後ろで改行する要素（「本文」「20%OFF」がくっつかないように） */
const BLOCKS = 'p, div, li, dt, dd, tr, td, th, h1, h2, h3, h4, h5, h6, section, article, table, blockquote, pre, hr';
/** JSで中身を描画するサイトの「描画先」になりがちな要素 */
const JS_MOUNTS = '#root, #app, #__next, #__nuxt';

/** 7章の目安（実在の印刷所で試して調整する） */
export const SHORT_TEXT = 200;
const ALMOST_EMPTY = 50;
const MANY_SCRIPTS = 3;

/** 7章：短文などの「注意」と、JS依存の疑い（要手動確認） */
export type ExtractNote = 'short' | 'short_with_images' | 'js_suspect' | 'selector_not_found';

export interface ExtractOptions {
  /** 本文の場所（印刷所マスターの crawl_selector） */
  selector?: string | null;
  /** 取り除く場所（crawl_ignore） */
  ignore?: string[];
  /** フェアへのリンクがある場所（fair_link_selector） */
  linkSelector?: string | null;
}

export interface Extracted {
  text: string;
  hash: string;
  /** 正規化済みの絶対URL（重複なし） */
  links: string[];
  notes: ExtractNote[];
}

export function extract(html: string, pageUrl: string, options: ExtractOptions = {}): Extracted {
  const $ = cheerio.load(html);
  const notes: ExtractNote[] = [];
  const base = resolveBase($('base[href]').attr('href'), pageUrl);

  // JS依存の手がかりは、要素を取り除く前に見ておく
  const emptyMount = $(JS_MOUNTS).toArray().some((el) => $(el).text().trim() === '');
  const noscriptSaysJs = /javascript/i.test($('noscript').text());
  const scriptCount = $('script').length;

  // fair_link_selector は、取り除く要素の中にあっても使えるよう先に読む
  let links: string[] | null = options.linkSelector ? collectLinks($, $(options.linkSelector), base) : null;

  $(REMOVE).remove();
  for (const sel of options.ignore ?? []) $(sel).remove();

  let area = options.selector ? $(options.selector).first() : null;
  if (options.selector && area?.length === 0) {
    notes.push('selector_not_found'); // サイトの作りが変わった可能性
    area = null;
  }
  if (!area) area = ['main', 'article', 'body'].map((sel) => $(sel).first()).find((el) => el.length > 0) ?? $.root();

  links ??= collectLinks($, area, base);
  const imageCount = area.find('img').length;

  area.find('br').replaceWith('\n');
  area.find(BLOCKS).append('\n');
  const text = normalizeText(area.text());

  if (text.length < SHORT_TEXT) {
    const scriptsOnly = scriptCount >= MANY_SCRIPTS && text.length < ALMOST_EMPTY;
    if (emptyMount || noscriptSaysJs || scriptsOnly) notes.push('js_suspect');
    else notes.push(imageCount > 0 ? 'short_with_images' : 'short');
  }

  return { text, hash: hashText(text), links, notes };
}

/** 5-2：Unicode正規化（全角英数・半角カナのゆれ）と、空白・改行の統一。日付・数字は消さない */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .split(/\r\n?|\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}

export function hashText(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

function resolveBase(href: string | undefined, pageUrl: string): string {
  if (!href) return pageUrl;
  try {
    return new URL(href, pageUrl).toString();
  } catch {
    return pageUrl;
  }
}

function collectLinks($: cheerio.CheerioAPI, scope: cheerio.Cheerio<any>, base: string): string[] {
  const anchors = scope.filter('a[href]').add(scope.find('a[href]'));
  const urls = anchors.toArray().map((el) => normalizeUrl($(el).attr('href') ?? '', base));
  return [...new Set(urls.filter((u): u is string => u !== null && !isNonHtml(u)))];
}

/** 追跡用のパラメータ（6-2） */
const TRACKING_PARAM = /^(utm_.*|fbclid|gclid)$/i;

/**
 * 6-2：同じページが別のURLとして登録されないようにそろえる。
 * 相対URL→絶対URL、# 以降と追跡用パラメータを取る。ホスト名の小文字化・既定のポートの除去は URL がする。
 * それ以外のパラメータと末尾の / はページの区別に使われていることがあるので変えない
 */
export function normalizeUrl(href: string, base: string): string | null {
  let url: URL;
  try {
    url = new URL(href.trim(), base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  const tracking = [...url.searchParams.keys()].filter((key) => TRACKING_PARAM.test(key));
  // 何も取らないときは search に触らない（書き直すと %20 → + などに変わってしまうため）
  if (tracking.length > 0) {
    for (const key of tracking) url.searchParams.delete(key);
  }
  return url.toString();
}

/** PDF・画像・zip など、HTMLではないと拡張子で分かるもの（6-1） */
function isNonHtml(url: string): boolean {
  return /\.(pdf|jpe?g|png|gif|webp|svg|zip|lzh|rar|psd|ai|clip|xlsx?|docx?|pptx?|mp4|mov|txt|csv)$/i.test(new URL(url).pathname);
}
