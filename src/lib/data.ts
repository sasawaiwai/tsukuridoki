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

export function loadSiteData(): SiteData {
  return {
    fairs: readYamlDir<Fair>('fairs').map((f) => f.data),
    printers: readYamlDir<Printer>('printers').map((f) => f.data),
    papers: readYamlDir<Paper>('papers').map((f) => f.data),
    foils: readYamlDir<Foil>('foils').map((f) => f.data),
    processes: readYamlFile<Process[]>('processes/processes.yaml').data,
    tags: readYamlFile<Tag[]>('tags/tags.yaml').data,
  };
}
