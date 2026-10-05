// フェアの公式情報源（sources）。URLを並べるだけで登録でき、種類はURLから判定する。
// 「フェアには最低1件の公式情報源が必要」（公式サイトURLは必須ではない）

import type { Fair, Printer } from './types.ts';

export type SourceKind = 'website' | 'x' | 'instagram' | 'bluesky' | 'other';

/** SNSのドメイン → 種類。投稿元が公式アカウントかどうかは運営者が登録時に確認する */
const SNS_HOSTS: Record<string, SourceKind> = {
  'x.com': 'x',
  'twitter.com': 'x',
  'instagram.com': 'instagram',
  'bsky.app': 'bluesky',
};

export const SOURCE_LABELS: Record<SourceKind, string> = {
  website: '公式サイト',
  x: '公式X',
  instagram: '公式Instagram',
  bluesky: '公式Bluesky',
  other: '公式の告知ページ',
};

function hostOf(url: string): string {
  return new URL(url).hostname.replace(/^(www|mobile)\./, '');
}

export function hostMatches(url: string, domains: string[]): boolean {
  const host = hostOf(url);
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

export function isSnsUrl(url: string): boolean {
  return hostOf(url) in SNS_HOSTS;
}

/**
 * URLの種類：SNS → その種類／印刷所の公式サイトと同じドメイン → website／
 * それ以外（印刷所の domains に追加した別サイトの告知ページなど）→ other
 */
export function sourceKind(url: string, printer?: Printer): SourceKind {
  const sns = SNS_HOSTS[hostOf(url)];
  if (sns) return sns;
  if (!printer || hostMatches(url, [hostOf(printer.official_url)])) return 'website';
  return 'other';
}

export interface SourceLink {
  kind: SourceKind;
  href: string;
  label: string;
}

/**
 * 詳細ページのリンク。1件目がメイン（公式サイトがあれば公式サイト、なければ最初の情報源）。
 * 公式サイトは link_policy に従う（32章：deep_link_ok 以外は印刷所のトップへ）。同じリンク先は1つにまとめる
 */
export function sourceLinks(fair: Fair, printer: Printer | undefined): { links: SourceLink[]; topPageOnly: boolean } {
  const printerName = printer?.name ?? fair.printer_id;
  const deepLink = printer?.link_policy === 'deep_link_ok';
  const items = fair.sources.map((url) => ({ url, kind: sourceKind(url, printer) }));
  const ordered = [...items.filter((s) => s.kind === 'website'), ...items.filter((s) => s.kind !== 'website')];

  const seen = new Set<string>();
  const count: Partial<Record<SourceKind, number>> = {};
  const links: SourceLink[] = [];
  let topPageOnly = false;
  for (const { url, kind } of ordered) {
    const href = kind === 'website' && !deepLink && printer ? printer.official_url : url;
    if (seen.has(href)) continue;
    seen.add(href);
    count[kind] = (count[kind] ?? 0) + 1;
    const n = count[kind]! > 1 ? `（${count[kind]}）` : '';
    let label = `${SOURCE_LABELS[kind]}での告知を見る${n}`;
    if (kind === 'website') {
      label = deepLink ? `公式サイトでフェアの詳細を見る${n}` : `${printerName}の公式サイトへ`;
      if (!deepLink) topPageOnly = true;
    }
    links.push({ kind, href, label });
  }
  return { links, topPageOnly };
}
