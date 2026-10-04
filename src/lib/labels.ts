// 表示名（データの値 → 画面に出す日本語）

import type { BenefitType, Binding, BookType, ColorMode, PrintingMethod, Size } from './types.ts';
import type { FairStatus } from './period.ts';

export const SIZE_LABELS: Record<Size, string> = {
  A6: 'A6',
  B6: 'B6',
  A5: 'A5',
  B5: 'B5',
  A4: 'A4',
  shinsho: '新書',
  bunko: '文庫',
  square: '正方形',
  custom: '変形',
  other: 'その他',
};

export const BINDING_LABELS: Record<Binding, string> = {
  perfect: '無線綴じ',
  saddle: '中綴じ',
  other: 'その他',
};

export const BOOK_TYPE_LABELS: Record<BookType, string> = {
  novel: '小説',
  manga: '漫画',
  illustration: 'イラスト集',
  photo: '写真集',
  full_color: 'フルカラー本',
  other: 'その他',
};

export const PRINTING_METHOD_LABELS: Record<PrintingMethod, string> = {
  ondemand: 'オンデマンド',
  offset: 'オフセット',
  digital_offset: 'デジタルオフセット',
  inkjet: 'インクジェット',
  other: 'その他',
};

export const COLOR_MODE_LABELS: Record<ColorMode, string> = {
  RGB: 'RGB対応',
  CMYK: 'CMYK',
  grayscale: 'グレースケール',
  monochrome: 'モノクロ',
  spot_color: '特色',
};

export const BENEFIT_LABELS: Record<BenefitType, string> = {
  discount: '割引',
  free_process: '加工無料',
  free_paper_upgrade: '用紙変更無料',
  free_option: 'オプション無料',
  limited_set: '限定セット',
  novelty: 'ノベルティ',
  points: 'ポイント',
  limited_product: '限定商品',
};

export const STATUS_LABELS: Record<FairStatus, string> = {
  upcoming: '開催前',
  active: '開催中',
  expired: '終了',
  unknown: '期間不明',
};
