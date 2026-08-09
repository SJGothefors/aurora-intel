export type CaseStatus = 'Ny' | 'Under bearbetning' | 'Uppföljning' | 'Avslutad';
export type Actor = 'Okänd' | 'Misstänkt främmande' | 'Civil' | 'Egen';
export type SourceAssessment = 'Okänd' | 'Låg' | 'Medel' | 'Hög';

export interface Note {
  id: string | number;
  entity_type: 'case' | 'begrepp' | 'spaningsfraga';
  entity_id: string | number;
  ts: string;
  text: string;
}

export interface IntelCase {
  id: string | number;
  lopnr: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  status: CaseStatus;
  star: boolean;
  tags: string[];
  begrepp: string[];
  aktor: Actor;
  source_report_id: string | null;
  source_assessment: SourceAssessment;
  dtg_raw: string | null;
  time_utc: string | null;
  time_uncertain: boolean;
  place_raw: string | null;
  place_name: string | null;
  mgrs: string | null;
  lat: number | null;
  lon: number | null;
  position_missing: boolean;
  styrka_raw: string | null;
  count_min: number | null;
  count_max: number | null;
  slag: string | null;
  sysselsattning: string | null;
  activity_summary: string | null;
  symbol: string | null;
  traits_summary: string | null;
  sagesman: string | null;
  kallrapport_raw: string | null;
  ai_json: unknown;
  bedomning: string | null;
  fields_uncertain: string[];
  notes?: Note[];
}

export interface VocabularyTerm {
  id: string | number;
  name_sv: string;
  name_en: string;
  definition: string;
  active: boolean;
  sidc: string;
  sort: number;
  notes?: Note[];
}

export interface CollectionQuestion {
  id: string | number;
  question: string;
  motivering: string;
  prioritet: 'Hög' | 'Medel' | 'Låg';
  status: 'Föreslagen' | 'Aktiv' | 'Besvarad' | 'Avförd';
  linked_case_ids: Array<string | number>;
  created_by: 'AI' | 'user';
  created_at: string;
  updated_at: string;
  forslag_inhamtning?: string;
  notes?: Note[];
}

export interface LlmStatus {
  status: 'online' | 'offline' | 'starting' | 'error';
  model?: string;
  detail?: string;
}

export interface AiJob {
  id: string | number;
  type: 'extract' | 'ask' | 'assess' | 'collection_questions' | string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  created_at?: string;
  error?: string;
  progress?: number;
}

export interface Settings {
  appPort: number;
  llmPort: number;
  lang: 'sv' | 'en';
  theme: 'dark';
  accent: string;
  density: 'compact' | 'comfortable';
  operatorName: string;
  bannerText: string;
  likelihoodScale: string[];
  backupIntervalMin: number;
  spaningsfragaTrigger: number;
  modelPath: string;
}

export interface WeatherEntry {
  id: number;
  forecast_at: string;
  temperature_c: number | null;
  rain_mm: number | null;
  humidity_pct: number | null;
  cloud_pct: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnalysisJob {
  id: string;
  type: 'overview';
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  result?: Assessment;
  error_code?: string;
  created_at?: string;
  finished_at?: string;
}

export interface ExtractionField<T> {
  raw?: string | null;
  iso_utc?: string | null;
  mgrs?: string | null;
  lat?: number | null;
  lon?: number | null;
  place_name?: string | null;
  count_min?: number | null;
  count_max?: number | null;
  uncertain?: boolean;
  value?: T;
}

export interface ExtractedReport {
  source_report_id: string | null;
  stunden: ExtractionField<string>;
  stallet: ExtractionField<string>;
  styrkan: ExtractionField<string>;
  slaget: string | null;
  sysselsattningen: string | null;
  symbolen: string | null;
  sagesmannen: string | null;
  begrepp: string[];
  position_missing: boolean;
  fields_uncertain: string[];
  summary_sv?: string;
  summary_en?: string;
}

export interface AskAnswer {
  answer: string;
  cited_case_ids: Array<string | number>;
  pattern?: {
    type: 'cluster' | 'route' | 'trend' | null;
    description: string;
  };
}

export interface Assessment {
  fakta: string;
  bedomning: string;
  sannolikhet: string;
  motivering: string;
  rekommendation: string;
}

export interface ImportIssue {
  row?: number;
  code?: string;
  message?: string;
  [key: string]: unknown;
}

export interface ImportDuplicate {
  row: number;
  matches: Array<{ id?: string | number; lopnr?: number; [key: string]: unknown }>;
}

export interface ImportPreview {
  token: string;
  headers: string[];
  auto_mapping: Record<string, string>;
  counts: {
    cases: number;
    spaningsfragor: number;
    begrepp: number;
  };
  duplicates: ImportDuplicate[];
  errors: ImportIssue[];
  warnings?: ImportIssue[];
  can_apply: boolean;
}

export interface ImportApplyResult {
  inserted: number;
  updated: number;
  skipped: number;
  questions: number;
  vocabulary: number;
}

export interface CaseFilters {
  query: string;
  status: string;
  actor: string;
  vocabulary: string;
  tag: string;
  starOnly: boolean;
  missingPosition: boolean;
  mapExtentOnly: boolean;
  dateFrom: string;
  dateTo: string;
}

export const DEFAULT_FILTERS: CaseFilters = {
  query: '',
  status: '',
  actor: '',
  vocabulary: '',
  tag: '',
  starOnly: false,
  missingPosition: false,
  mapExtentOnly: false,
  dateFrom: '',
  dateTo: '',
};

export const DEFAULT_SETTINGS: Settings = {
  appPort: 8474,
  llmPort: 8475,
  lang: 'sv',
  theme: 'dark',
  accent: '#f0568c',
  density: 'compact',
  operatorName: '',
  bannerText: 'EJ SEKRETESSKLASSAT – ÖVNING',
  likelihoodScale: ['mycket osannolikt', 'osannolikt', 'möjligt', 'sannolikt', 'mycket sannolikt'],
  backupIntervalMin: 30,
  spaningsfragaTrigger: 3,
  modelPath: '',
};

export type PanelTab = 'intake' | 'ask' | 'questions';
export type AppDialog = 'settings' | 'vocabulary' | 'importExport' | 'shortcuts' | null;
