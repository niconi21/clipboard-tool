export interface ClipboardEntry {
  id: number;
  content: string;
  content_type: string;
  category: string; // COALESCE(cat.name, 'other') from DB
  source_app: string | null;
  window_title: string | null;
  is_favorite: boolean;
  created_at: string;
  collection_ids: string; // comma-separated collection ids, e.g. "1,3" or ""
  alias: string | null;
}

export interface Category {
  id: number;
  name: string;
  color: string;
  is_builtin: boolean;
  created_at: string;
}

export interface ContentTypeStyle {
  name: string;
  label: string;
  color: string; // hex, e.g. "#3b82f6"
  is_builtin: boolean;
}

export interface ContextRule {
  id: number;
  category_id: number | null;
  category_name: string;
  source_app_pattern: string | null;
  window_title_pattern: string | null;
  priority: number;
  enabled: boolean;
  is_builtin: boolean;
  created_at: string;
}

export interface ContentRule {
  id: number;
  content_type: string;
  pattern: string;
  min_hits: number;
  priority: number;
  enabled: boolean;
  is_builtin: boolean;
  created_at: string;
}

export interface CollectionRule {
  id: number;
  collection_id: number;
  collection_name: string;
  content_type: string | null;
  source_app: string | null;
  window_title: string | null;
  content_pattern: string | null;
  priority: number;
  enabled: boolean;
  is_builtin: boolean;
  created_at: string;
}

export interface Collection {
  id: number;
  name: string;
  color: string;
  is_builtin: boolean;
  created_at: string;
}

export interface Subcollection {
  id: number;
  collection_id: number;
  name: string;
  is_default: boolean;
  created_at: string;
}

export interface Setting {
  key: string;
  value: string;
  updated_at: string;
}

export interface Language {
  code: string;        // BCP 47, e.g. "en", "es-MX"
  name: string;        // English name, e.g. "Spanish (Mexico)"
  native_name: string; // Native name, e.g. "Español (México)"
  is_active: boolean;
}

export interface BootstrapData {
  settings:          Setting[];
  themes:            Theme[];
  content_types:     ContentTypeStyle[];
  collections:       Collection[];
  collection_counts: [number, number][]; // [collection_id, count][]
  subcollections:    Subcollection[];
  languages:         Language[];
  entry_counts:      [number, number];   // [all, favorites]
}

export interface ImportSummary {
  settings: number;
  themes: number;
  categories: number;
  content_types: number;
  content_type_rules: number;
  context_rules: number;
  collections: number;
  subcollections: number;
  collection_rules: number;
}

export interface Theme {
  slug: string;
  name: string;
  base: string;
  surface: string;
  surface_raised: string;
  surface_active: string;
  stroke: string;
  stroke_strong: string;
  content: string;
  content_2: string;
  content_3: string;
  accent: string;
  accent_text: string;
  is_builtin: boolean;
}
