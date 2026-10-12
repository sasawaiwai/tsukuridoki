// data/ 以下のYAMLを読み込む（サイトのビルドと scripts/validate-data.mjs で共用）

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { Fair, Foil, Paper, Printer, Process, SiteData, Tag } from './types.ts';

export const DATA_DIR = join(process.cwd(), 'data');

export interface YamlFile<T = unknown> {
  file: string; // data/ からの相対パス
  data: T;
}

export function readYamlFile<T = unknown>(relativePath: string): YamlFile<T> {
  const text = readFileSync(join(DATA_DIR, relativePath), 'utf8');
  return { file: relativePath, data: parse(text) as T };
}

/** ディレクトリ内の *.yaml をファイル名順に読む */
export function readYamlDir<T = unknown>(dir: string): YamlFile<T>[] {
  const fullDir = join(DATA_DIR, dir);
  if (!existsSync(fullDir)) return [];
  return readdirSync(fullDir)
    .filter((name) => name.endsWith('.yaml'))
    .sort()
    .map((name) => readYamlFile<T>(join(dir, name)));
}

/**
 * ビルド中は1回だけ読み、全ページで使い回す（ページごとに全件を読み直すと、件数×ページ数で遅くなるため）。
 * 開発用サーバー（npm run dev）では、YAMLの変更がすぐ反映されるよう毎回読み直す。
 * import.meta.env がない Node の実行（データ検証・巡回）では使い回さない
 */
let buildCache: SiteData | null = null;

export function loadSiteData(): SiteData {
  if (import.meta.env?.PROD) return (buildCache ??= readSiteData());
  return readSiteData();
}

function readSiteData(): SiteData {
  return {
    fairs: readYamlDir<Fair>('fairs').map((f) => f.data),
    printers: readYamlDir<Printer>('printers').map((f) => f.data),
    papers: readYamlDir<Paper>('papers').map((f) => f.data),
    foils: readYamlDir<Foil>('foils').map((f) => f.data),
    processes: readYamlFile<Process[]>('processes/processes.yaml').data,
    tags: readYamlFile<Tag[]>('tags/tags.yaml').data,
  };
}
