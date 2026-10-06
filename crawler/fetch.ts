// 印刷所サイトの取得とアクセスマナー（仕様書7-4、phase3-design 4章）
// 取得したHTMLはメモリにだけ置き、ファイル・ログには出さない（7-2）

export const ROBOTS_TOKEN = 'TsukuridokiBot';
export const USER_AGENT = `${ROBOTS_TOKEN}/1.0 (+https://tsukuridoki.sasadokoro.online/contact/)`;
/** 同じサイトへの最低の間隔。robots.txt の Crawl-delay が長ければそちらに合わせる */
export const MIN_DELAY_MS = 5000;
export const TIMEOUT_MS = 20_000;
export const MAX_BYTES = 2 * 1024 * 1024;
export const MAX_REDIRECTS = 5;

/** 8-1 */
export type FetchStatus = 'ok' | 'not_modified' | 'not_found' | 'blocked' | 'error';

export interface FetchResult {
  fetch_status: FetchStatus;
  http_status: number | null;
  /** リダイレクト後のURL */
  url: string;
  html: string | null;
  etag: string | null;
  last_modified: string | null;
  /** 失敗の理由（画面・概要欄に出す） */
  reason: string | null;
}

export function statusFromHttp(code: number): FetchStatus {
  if (code >= 200 && code < 300) return 'ok';
  if (code === 304) return 'not_modified';
  if (code === 404 || code === 410) return 'not_found';
  if (code === 401 || code === 403 || code === 429) return 'blocked';
  return 'error';
}

/** 同じサイト（ホスト名）へは、前のアクセスが終わってから決めた時間をあける */
export class Pacer {
  private last = new Map<string, number>();

  async wait(url: string, delayMs: number): Promise<void> {
    const prev = this.last.get(new URL(url).hostname);
    const rest = prev === undefined ? 0 : prev + delayMs - Date.now();
    if (rest > 0) await new Promise((resolve) => setTimeout(resolve, rest));
  }

  done(url: string): void {
    this.last.set(new URL(url).hostname, Date.now());
  }
}

class FetchError extends Error {}

/** リダイレクト先を確認する。取得してはいけないときは理由を返す */
export type RedirectCheck = (url: string) => Promise<string | null>;

async function request(url: string, headers: Record<string, string>, checkRedirect: RedirectCheck) {
  let current = url;
  for (let hops = 0; hops <= MAX_REDIRECTS; hops++) {
    const res = await fetch(current, {
      headers: { 'User-Agent': USER_AGENT, ...headers },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status < 300 || res.status >= 400 || res.status === 304) return { res, url: current };

    await res.body?.cancel();
    const location = res.headers.get('location');
    if (!location) throw new FetchError(`移動先が示されていません（HTTP ${res.status}）`);
    const next = new URL(location, current).toString();
    const reason = await checkRedirect(next);
    if (reason) throw new FetchError(reason);
    current = next;
  }
  throw new FetchError(`リダイレクトが${MAX_REDIRECTS}回を超えました`);
}

async function readLimited(res: Response): Promise<Uint8Array> {
  if (Number(res.headers.get('content-length')) > MAX_BYTES) {
    await res.body?.cancel();
    throw new FetchError('2MBを超えています');
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of res.body ?? []) {
    total += chunk.length;
    if (total > MAX_BYTES) throw new FetchError('2MBを超えています');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function describeError(e: unknown): string {
  if (e instanceof FetchError) return e.message;
  if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) return `タイムアウト（${TIMEOUT_MS / 1000}秒）`;
  return '通信エラー';
}

/** 文字コード：応答ヘッダー → <meta charset> → UTF-8 の順で判定（Shift_JIS・EUC-JP の古いサイト向け） */
export function decodeHtml(bytes: Uint8Array, contentType: string | null): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1];
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096));
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  try {
    return new TextDecoder(fromHeader ?? fromMeta ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes); // 知らない文字コード名のとき
  }
}

export interface Conditional {
  etag?: string | null;
  last_modified?: string | null;
}

/** ページを1件取得する。HTMLだけ・2MBまで。304なら本文を取らない */
export async function fetchPage(url: string, conditional: Conditional, checkRedirect: RedirectCheck): Promise<FetchResult> {
  const result: FetchResult = { fetch_status: 'error', http_status: null, url, html: null, etag: null, last_modified: null, reason: null };
  const headers: Record<string, string> = { Accept: 'text/html,application/xhtml+xml' };
  if (conditional.etag) headers['If-None-Match'] = conditional.etag;
  if (conditional.last_modified) headers['If-Modified-Since'] = conditional.last_modified;

  try {
    const { res, url: finalUrl } = await request(url, headers, checkRedirect);
    result.url = finalUrl;
    result.http_status = res.status;
    result.fetch_status = statusFromHttp(res.status);
    if (result.fetch_status !== 'ok') {
      await res.body?.cancel();
      if (result.fetch_status !== 'not_modified') result.reason = `HTTP ${res.status}`;
      return result;
    }
    const type = res.headers.get('content-type');
    if (!/text\/html|application\/xhtml\+xml/i.test(type ?? '')) {
      await res.body?.cancel();
      return { ...result, fetch_status: 'error', reason: `HTMLではありません（${type ?? '種類不明'}）` };
    }
    result.html = decodeHtml(await readLimited(res), type);
    result.etag = res.headers.get('etag');
    result.last_modified = res.headers.get('last-modified');
    return result;
  } catch (e) {
    return { ...result, fetch_status: 'error', html: null, reason: describeError(e) };
  }
}

/** robots.txt を取得する。リダイレクトは最大5回まで追う（4-1） */
export async function fetchRobotsTxt(origin: string): Promise<{ http_status: number | null; body: string; reason: string | null }> {
  try {
    const { res } = await request(`${origin}/robots.txt`, {}, async () => null);
    if (res.status < 200 || res.status >= 300) {
      await res.body?.cancel();
      return { http_status: res.status, body: '', reason: null };
    }
    return { http_status: res.status, body: new TextDecoder('utf-8').decode(await readLimited(res)), reason: null };
  } catch (e) {
    return { http_status: null, body: '', reason: describeError(e) };
  }
}
