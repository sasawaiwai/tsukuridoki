// robots.txt の判定（仕様書7-4、phase3-design 4-1）
// RFC 9309 に沿う。ただし迷う場面は巡回しない側に倒す。
// robots.txt はアクセスの許可そのものではないので、利用規約で crawl_policy: allowed とした印刷所だけをここで確認する

import robotsParser from 'robots-parser';
import { MIN_DELAY_MS, ROBOTS_TOKEN } from './fetch.ts';

export type Robots =
  | { kind: 'rules'; isAllowed: (url: string) => boolean; delayMs: number }
  | { kind: 'unavailable'; reason: string };

/**
 * robots.txt の応答から判定を作る。
 * - 200：内容に従う。TsukuridokiBot のグループがあればそれだけ、無ければ * を使う（robots-parser の動作）
 * - 404・410：制限なし
 * - 401・403：RFC では巡回してよいとされるが、断られている可能性があるので巡回しない
 * - 429・5xx・通信エラー・その他：巡回しない
 * 間隔は max(5秒, Crawl-delay)。Crawl-delay は RFC 9309 の規定ではないが広く使われている
 */
export function interpretRobots(robotsUrl: string, httpStatus: number | null, body: string, reason: string | null = null): Robots {
  if (httpStatus === null) return { kind: 'unavailable', reason: `robots.txt を取得できません（${reason ?? '通信エラー'}）` };
  if (httpStatus >= 200 && httpStatus < 300) {
    const robots = robotsParser(robotsUrl, body);
    const crawlDelay = Number(robots.getCrawlDelay(ROBOTS_TOKEN) ?? 0);
    return {
      kind: 'rules',
      isAllowed: (url) => robots.isAllowed(url, ROBOTS_TOKEN) === true,
      delayMs: Math.max(MIN_DELAY_MS, Number.isFinite(crawlDelay) ? crawlDelay * 1000 : 0),
    };
  }
  if (httpStatus === 404 || httpStatus === 410) return { kind: 'rules', isAllowed: () => true, delayMs: MIN_DELAY_MS };
  if (httpStatus === 401 || httpStatus === 403) return { kind: 'unavailable', reason: `robots.txt へのアクセスを断られました（HTTP ${httpStatus}）` };
  return { kind: 'unavailable', reason: `robots.txt を取得できません（HTTP ${httpStatus}）` };
}
