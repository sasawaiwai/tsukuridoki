// データの型。ルールの正本は schemas/*.schema.json（こちらは表示側で使う型の写し）

export type DateString = string; // YYYY-MM-DD
export type Precision = 'day' | 'month' | 'unknown';

export type Size = 'A6' | 'B6' | 'A5' | 'B5' | 'A4' | 'shinsho' | 'bunko' | 'square' | 'custom' | 'other';
export type Binding = 'perfect' | 'saddle' | 'other';
export type BookType = 'novel' | 'manga' | 'illustration' | 'photo' | 'full_color' | 'other';
export type PrintingMethod = 'ondemand' | 'offset' | 'digital_offset' | 'inkjet' | 'other';
export type ColorMode = 'RGB' | 'CMYK' | 'grayscale' | 'monochrome' | 'spot_color';
export type BenefitType =
  | 'discount'
  | 'free_process'
  | 'free_paper_upgrade'
  | 'free_option'
  | 'limited_set'
  | 'novelty'
  | 'points'
  | 'limited_product';
export type SourceType = 'official_fair' | 'official_campaign' | 'official_news' | 'official_sns' | 'official_other';
export type VerificationStatus = 'verified' | 'auto_checked' | 'needs_review' | 'unknown';
export type DeadlineType = 'normal' | 'early' | 'special' | 'event' | 'unknown';
export type HistoryType = 'discovered' | 'published' | 'updated' | 'expired';
/** 開催タイプ（仕様書57章）。省略時は period */
export type TimingType = 'period' | 'specific_dates' | 'ongoing';

/** 入稿日限定の入稿日 */
export interface SubmissionDate {
  date: DateString;
  delivery_date?: DateString | null;
  note?: string | null;
}

export interface Fair {
  fair_id: string;
  slug: string;
  fair_name: string;
  printer_id: string;
  category: 'dojinshi';

  /** 公式情報源のURL（公式サイト・Xの告知投稿など）。最低1件。種類は sources.ts でURLから判定する */
  sources: string[];

  summary: string;
  benefit_summary?: string | null;

  start_date?: DateString | null;
  end_date?: DateString | null;
  start_date_text?: string | null;
  end_date_text?: string | null;
  start_date_precision?: Precision | null;
  end_date_precision?: Precision | null;

  usable_from?: DateString | null;
  usable_until?: DateString | null;
  usable_from_text?: string | null;
  usable_until_text?: string | null;
  usable_from_precision?: Precision | null;
  usable_until_precision?: Precision | null;

  /** 開催タイプ。省略時は期間限定（period） */
  timing_type?: TimingType;
  /** 入稿日限定（specific_dates）の入稿日。日付順 */
  submission_dates?: SubmissionDate[];
  submission_dates_text?: string | null;

  published_at: DateString;
  discovered_at?: DateString | null;
  last_checked_at?: DateString | null;
  verified_at?: DateString | null;
  updated_at?: DateString | null;

  source_type: SourceType;
  verification_status: VerificationStatus;

  notes?: string | null;

  deadline_type?: DeadlineType | null;
  deadline_offset?: number | null;
  extra_days?: number | null;
  event_name?: string | null;
  event_date?: DateString | null;
  event_deadline?: DateString | null;
  deadline_note?: string | null;

  sizes?: Size[];
  custom_size_supported?: boolean | null;

  min_pages?: number | null;
  max_pages?: number | null;
  min_quantity?: number | null;
  max_quantity?: number | null;

  binding?: Binding[];
  book_types?: BookType[];
  printing_methods?: PrintingMethod[];
  color_modes?: ColorMode[];
  rgb_supported?: boolean | null;
  rgb_conversion?: string | null;
  spot_color_supported?: boolean | null;

  processes?: string[];
  papers?: { mode: 'selected' | 'all_special_papers'; items?: string[] };
  foils?: { mode: 'selected' | 'all_foils'; items?: string[] };
  tags?: string[];

  benefit_types?: BenefitType[];
  discount_rate?: number | null;
  discount_amount?: number | null;
  free_options?: string[];
  campaign_code?: string | null;

  new_customer_only?: boolean | null;
  member_only?: boolean | null;
  event_delivery_only?: boolean | null;
  specific_sets_only?: boolean | null;
  combinable?: boolean | null;
  application_required?: boolean | null;
  minimum_order?: string | null;
  conditions_text?: string | null;

  history?: {
    date: DateString;
    type: HistoryType;
    field?: string | null;
    old_value?: unknown;
    new_value?: unknown;
  }[];
}

export interface Printer {
  printer_id: string;
  name: string;
  official_url: string;
  fair_index_url?: string | null;
  watch_urls?: string[];
  domains: string[];
  link_policy: 'deep_link_ok' | 'top_page_only' | 'unknown';
  crawl_policy: 'allowed' | 'manual_only' | 'forbidden' | 'unknown';
  terms_url?: string | null;
  policy_note?: string | null;
  /** 巡回で本文として扱う場所（CSSセレクタ）。無ければ main → article → body */
  crawl_selector?: string | null;
  /** 巡回で取り除く場所（アクセスカウンターなど毎回変わる部分） */
  crawl_ignore?: string[];
  /** 一覧ページで、フェアへのリンクがある場所 */
  fair_link_selector?: string | null;
  crawl_interval_days?: number;
  last_crawled_at?: string | null;
  last_policy_checked_at?: DateString | null;
}

export interface Paper {
  paper_id: string;
  name: string;
  color?: string | null;
  category?: string | null;
  features?: string[];
  use?: string[];
  manufacturer?: string | null;
  weight?: string | null;
}

export interface Foil {
  foil_id: string;
  name: string;
  category?: string | null;
  color_family?: string | null;
  manufacturer?: string | null;
  printer_specific_name?: string | null;
}

export interface Process {
  process_id: string;
  name: string;
  group: 'foil_cover' | 'surface' | 'edge' | 'cutting' | 'body' | 'other';
}

export interface Tag {
  tag_id: string;
  name: string;
}

export interface SiteData {
  fairs: Fair[];
  printers: Printer[];
  papers: Paper[];
  foils: Foil[];
  processes: Process[];
  tags: Tag[];
}
