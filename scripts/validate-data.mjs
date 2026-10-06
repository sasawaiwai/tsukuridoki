// データ検証：data/ 以下のYAMLを schemas/ のルールとファイル同士のつながりで確認する。
// エラーがあれば日本語で表示し、終了コード1で止める（ビルドも止まる）。

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { DATA_DIR, readYamlDir, readYamlFile } from '../src/lib/data.ts';
import { hostMatches, isSafeUrl, isSnsUrl } from '../src/lib/sources.ts';

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);

function loadSchema(name) {
  const schema = JSON.parse(readFileSync(join(process.cwd(), 'schemas', name), 'utf8'));
  return ajv.compile(schema);
}

const validators = {
  fair: loadSchema('fair.schema.json'),
  printer: loadSchema('printer.schema.json'),
  paper: loadSchema('paper.schema.json'),
  foil: loadSchema('foil.schema.json'),
  processes: loadSchema('processes.schema.json'),
  tags: loadSchema('tags.schema.json'),
  crawlerState: loadSchema('crawler-state.schema.json'),
  extraction: loadSchema('extraction.schema.json'),
};

const errors = [];
const report = (file, message) => errors.push({ file, message });

// ---- JSON Schema のエラーを日本語にする ----

function fieldName(instancePath) {
  return instancePath
    .slice(1)
    .split('/')
    .map((part) => (/^\d+$/.test(part) ? `[${part}]` : `.${part}`))
    .join('')
    .replace(/^\./, '');
}

function describe(error) {
  const field = fieldName(error.instancePath);
  const where = error.instancePath ? `（場所：${field}）` : '';
  const p = error.params;
  switch (error.keyword) {
    case 'required':
      return `必須項目「${p.missingProperty}」がありません${where}`;
    case 'additionalProperties':
      return `「${p.additionalProperty}」はルールにない項目です。綴りを確認してください${where}`;
    case 'enum':
      return `「${field}」の値が選択肢にありません。使える値：${p.allowedValues.map(String).join(' / ')}`;
    case 'const':
      return `「${field}」の値は ${p.allowedValue} でなければいけません`;
    case 'type':
      return `「${field}」の種類が違います（期待：${[].concat(p.type).join(' または ')}）`;
    case 'format': {
      const hint = { date: 'YYYY-MM-DD', 'date-time': '日時（例：2026-10-05T05:00:00+09:00）', uri: 'https:// から始まるURL', hostname: 'ドメイン名（例：example.com）' }[p.format];
      return `「${field}」の形式が違います（期待：${hint ?? p.format}）`;
    }
    case 'pattern':
      if (p.pattern === '^https?://') return `「${field}」は http:// か https:// で始まるURLにしてください`;
      return `「${field}」に使えない文字があります（半角英小文字・数字・ハイフン等のみ）`;
    case 'minLength':
      return `「${field}」が空です`;
    case 'minItems':
      return `「${field}」は ${p.limit} 件以上必要です`;
    case 'uniqueItems':
      return `「${field}」に同じ値が重複しています`;
    case 'minimum':
    case 'exclusiveMinimum':
    case 'maximum':
      return `「${field}」の数値が範囲外です（${error.message}）`;
    case 'if':
      return null; // then 側のエラーで説明されるため省略
    default:
      return `「${field}」：${error.message}`;
  }
}

function checkSchema(kind, { file, data }) {
  const validate = validators[kind];
  if (!validate(data)) {
    for (const error of validate.errors) {
      const message = describe(error);
      if (message) report(file, message);
    }
    return false;
  }
  return true;
}

// ---- 読み込み ----

function safeRead(fn, file) {
  try {
    return fn();
  } catch (e) {
    report(file, `YAMLとして読み込めません：${e.message.split('\n')[0]}`);
    return null;
  }
}

const fairs = safeRead(() => readYamlDir('fairs'), 'fairs/') ?? [];
const printers = safeRead(() => readYamlDir('printers'), 'printers/') ?? [];
const papers = safeRead(() => readYamlDir('papers'), 'papers/') ?? [];
const foils = safeRead(() => readYamlDir('foils'), 'foils/') ?? [];
const processesFile = safeRead(() => readYamlFile('processes/processes.yaml'), 'processes/processes.yaml');
const tagsFile = safeRead(() => readYamlFile('tags/tags.yaml'), 'tags/tags.yaml');
// 巡回の記録は、初めて巡回するまで存在しない
const stateFile = existsSync(join(DATA_DIR, 'crawler/state.yaml'))
  ? safeRead(() => readYamlFile('crawler/state.yaml'), 'crawler/state.yaml')
  : null;

// ---- Schema ----

const validFairs = fairs.filter((f) => checkSchema('fair', f));
const validPrinters = printers.filter((f) => checkSchema('printer', f));
const validPapers = papers.filter((f) => checkSchema('paper', f));
const validFoils = foils.filter((f) => checkSchema('foil', f));
if (processesFile) checkSchema('processes', processesFile);
if (tagsFile) checkSchema('tags', tagsFile);
const validState = stateFile ? checkSchema('crawlerState', stateFile) : false;

// ---- ファイル名とIDの一致・ID重複 ----

function checkIds(entries, idField) {
  const seen = new Map();
  for (const { file, data } of entries) {
    const id = data[idField];
    if (basename(file, '.yaml') !== id) {
      report(file, `ファイル名と ${idField}（${id}）が一致しません。ファイル名を「${id}.yaml」にしてください`);
    }
    if (seen.has(id)) report(file, `${idField}「${id}」が ${seen.get(id)} と重複しています`);
    seen.set(id, file);
  }
  return new Set(seen.keys());
}

function checkListIds(entry, idField) {
  const ids = new Set();
  if (!entry || !Array.isArray(entry.data)) return ids;
  for (const item of entry.data) {
    if (ids.has(item[idField])) report(entry.file, `${idField}「${item[idField]}」が重複しています`);
    ids.add(item[idField]);
  }
  return ids;
}

checkIds(validFairs, 'fair_id');
const printerIds = checkIds(validPrinters, 'printer_id');
const paperIds = checkIds(validPapers, 'paper_id');
const foilIds = checkIds(validFoils, 'foil_id');
const processIds = checkListIds(processesFile, 'process_id');
const tagIds = checkListIds(tagsFile, 'tag_id');

const slugs = new Map();
for (const { file, data } of validFairs) {
  if (slugs.has(data.slug)) report(file, `slug「${data.slug}」が ${slugs.get(data.slug)} と重複しています`);
  slugs.set(data.slug, file);
}

// ---- 参照・URL・日付の順序 ----

const printerById = new Map(validPrinters.map(({ data }) => [data.printer_id, data]));

// リンクに使うURLは、URLとして解析して http・https で、ユーザー名・パスワードを含まないものに限る
function checkUrls(file, label, urls) {
  for (const url of urls) {
    if (url != null && !isSafeUrl(url)) report(file, `${label} の ${url} は使えないURLです（http:// か https:// のみ。ユーザー名・パスワード付きは不可）`);
  }
}
for (const { file, data: p } of validPrinters) {
  checkUrls(file, 'official_url・fair_index_url・watch_urls・terms_url', [p.official_url, p.fair_index_url, ...(p.watch_urls ?? []), p.terms_url]);
}

for (const { file, data: fair } of validFairs) {
  const printer = printerById.get(fair.printer_id);
  if (!printerIds.has(fair.printer_id)) {
    report(file, `printer_id「${fair.printer_id}」の印刷所が data/printers/ にありません`);
  }

  for (const id of fair.processes ?? []) {
    if (!processIds.has(id)) report(file, `processes の「${id}」が加工マスターにありません`);
  }
  for (const id of fair.tags ?? []) {
    if (!tagIds.has(id)) report(file, `tags の「${id}」がタグマスターにありません`);
  }
  for (const id of fair.papers?.items ?? []) {
    if (!paperIds.has(id)) report(file, `papers.items の「${id}」が data/papers/ にありません`);
  }
  for (const id of fair.foils?.items ?? []) {
    if (!foilIds.has(id)) report(file, `foils.items の「${id}」が data/foils/ にありません`);
  }

  checkUrls(file, 'sources', fair.sources ?? []);

  if (printer) {
    // SNS（X・Instagram・Bluesky）は運営者が公式投稿か確認して登録する。それ以外は印刷所のドメインに限る
    for (const url of fair.sources ?? []) {
      if (!isSnsUrl(url) && !hostMatches(url, printer.domains)) {
        report(
          file,
          `sources の ${url} のドメインが印刷所「${printer.name}」の domains（${printer.domains.join(', ')}）と一致しません。公式の告知ページなら data/printers/ の domains に追加してください`,
        );
      }
    }
  }

  const order = [
    ['start_date', 'end_date'],
    ['usable_from', 'usable_until'],
    ['min_pages', 'max_pages'],
    ['min_quantity', 'max_quantity'],
  ];
  for (const [a, b] of order) {
    if (fair[a] != null && fair[b] != null && fair[a] > fair[b]) {
      report(file, `${a}（${fair[a]}）が ${b}（${fair[b]}）より後・大きくなっています`);
    }
  }
}

if (validState) {
  const seenUrls = new Set();
  for (const entry of stateFile.data) {
    if (!printerIds.has(entry.printer_id)) report(stateFile.file, `printer_id「${entry.printer_id}」の印刷所が data/printers/ にありません（${entry.url}）`);
    if (seenUrls.has(entry.url)) report(stateFile.file, `URL「${entry.url}」が重複しています`);
    seenUrls.add(entry.url);
  }
}

// 確認作業の記録（抽出結果）
const reviewsDir = join(DATA_DIR, 'reviews');
if (existsSync(reviewsDir)) {
  for (const name of readdirSync(reviewsDir, { recursive: true, encoding: 'utf8' }).filter((n) => n.endsWith('.json'))) {
    const file = join('reviews', name);
    const data = safeRead(() => JSON.parse(readFileSync(join(reviewsDir, name), 'utf8')), file);
    if (data && checkSchema('extraction', { file, data }) && !printerIds.has(data.printer_id)) {
      report(file, `printer_id「${data.printer_id}」の印刷所が data/printers/ にありません`);
    }
  }
}

// ---- 結果 ----

if (errors.length > 0) {
  console.error(`\n❌ データ検証エラー：${errors.length}件\n`);
  for (const { file, message } of errors) console.error(`  data/${file}\n    → ${message}\n`);
  process.exit(1);
}

console.log(
  `✅ データ検証OK（フェア${fairs.length}件・印刷所${printers.length}件・用紙${papers.length}件・箔${foils.length}件・加工${processIds.size}件・タグ${tagIds.size}件）`,
);
