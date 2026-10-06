// 「取得してよいか」の判定と取得。巡回（crawl）と確認（review show）で共用し、
// review からアクセスマナーを迂回する経路を作らない（仕様書7-4、phase4-design 決定事項N）

import { hostMatches } from '../src/lib/sources.ts';
import type { Printer } from '../src/lib/types.ts';
import { fetchPage, fetchRobotsTxt, MIN_DELAY_MS, type Conditional, type FetchResult, type Pacer } from './fetch.ts';
import { interpretRobots, type Robots } from './robots.ts';

export const ROBOTS_DENIED = 'robots.txt で禁止されています';

export interface AccessContext {
  pacer: Pick<Pacer, 'wait' | 'done'>;
  /** robots.txt はサイト（オリジン）ごとに1回だけ取得する */
  robots: Map<string, Robots>;
}

export function printerAccess(printer: Printer, ctx: AccessContext) {
  async function robotsFor(url: string): Promise<Robots> {
    const origin = new URL(url).origin;
    let robots = ctx.robots.get(origin);
    if (!robots) {
      await ctx.pacer.wait(origin, MIN_DELAY_MS);
      const res = await fetchRobotsTxt(origin);
      ctx.pacer.done(origin);
      robots = interpretRobots(`${origin}/robots.txt`, res.http_status, res.body, res.reason);
      ctx.robots.set(origin, robots);
    }
    return robots;
  }

  /** 取得してよいか。だめなら理由を返す（リダイレクト先の確認にも使う） */
  async function denyReason(url: string): Promise<string | null> {
    if (printer.crawl_policy !== 'allowed') return `crawl_policy が ${printer.crawl_policy}`;
    if (!hostMatches(url, printer.domains)) return `印刷所の domains の外です（${new URL(url).hostname}）`;
    const robots = await robotsFor(url);
    if (robots.kind === 'unavailable') return robots.reason;
    return robots.isAllowed(url) ? null : ROBOTS_DENIED;
  }

  /** denyReason が null だったURLを取得する。同じサイトへは決めた間隔をあける */
  async function fetchAllowed(url: string, conditional: Conditional): Promise<FetchResult> {
    const robots = await robotsFor(url);
    await ctx.pacer.wait(url, robots.kind === 'rules' ? robots.delayMs : MIN_DELAY_MS);
    const result = await fetchPage(url, conditional, denyReason);
    ctx.pacer.done(url);
    return result;
  }

  return { denyReason, fetchAllowed };
}
