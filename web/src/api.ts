import type {
  AiJob,
  AskAnswer,
  Assessment,
  CollectionQuestion,
  ExtractedReport,
  IntelCase,
  LlmStatus,
  ImportApplyResult,
  ImportPreview,
  Settings,
  Note,
  VocabularyTerm,
  WeatherEntry,
  AnalysisJob,
} from './types';

const API_ROOT = '/api';

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const method = String(init?.method ?? 'GET').toUpperCase();
  if (init?.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  headers.set('Accept', 'application/json');
  if (method !== 'GET' && method !== 'HEAD') headers.set('X-Aurora-Request', '1');
  const response = await fetch(`${API_ROOT}${path}`, { ...init, headers });
  const type = response.headers.get('content-type') ?? '';
  const body: unknown = type.includes('application/json')
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    const rawError = typeof body === 'object' && body && 'error' in body ? body.error : null;
    const detail = typeof rawError === 'object' && rawError && 'message' in rawError
      ? String(rawError.message)
      : typeof rawError === 'string' ? rawError : response.statusText;
    throw new ApiError(detail || `HTTP ${response.status}`, response.status, body);
  }
  return body as T;
}

function unwrapList<T>(value: unknown, keys: string[]): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') {
    for (const key of keys) {
      const nested = (value as Record<string, unknown>)[key];
      if (Array.isArray(nested)) return nested as T[];
    }
  }
  return [];
}

function queryString(input: Record<string, string | number | boolean | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== '' && value !== false) params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export const api = {
  async getCases(options: { q?: string; signal?: AbortSignal } = {}): Promise<IntelCase[]> {
    const query = queryString({ limit: 50000, q: options.q });
    return unwrapList<IntelCase>(await request<unknown>(`/cases${query}`, { signal: options.signal }), ['rows', 'items', 'cases', 'data']);
  },
  createCase(input: Partial<IntelCase>): Promise<IntelCase> {
    return request('/cases', { method: 'POST', body: JSON.stringify(input) });
  },
  updateCase(id: IntelCase['id'], input: Partial<IntelCase>): Promise<IntelCase> {
    return request(`/cases/${encodeURIComponent(String(id))}`, { method: 'PATCH', body: JSON.stringify(input) });
  },
  deleteCase(id: IntelCase['id']): Promise<void> {
    return request(`/cases/${encodeURIComponent(String(id))}`, { method: 'DELETE' });
  },
  async getWeather(): Promise<WeatherEntry[]> {
    return unwrapList<WeatherEntry>(await request<unknown>('/weather'), ['rows']);
  },
  createWeather(input: Partial<WeatherEntry>): Promise<WeatherEntry> {
    return request('/weather', { method: 'POST', body: JSON.stringify(input) });
  },
  deleteWeather(id: WeatherEntry['id']): Promise<void> {
    return request(`/weather/${encodeURIComponent(String(id))}`, { method: 'DELETE' });
  },
  async getLatestAnalysis(): Promise<AnalysisJob | null> {
    return (await request<{ job: AnalysisJob | null }>('/analysis/latest')).job;
  },
  refreshAnalysis(lang: string): Promise<AnalysisJob> {
    return request('/analysis/refresh', { method: 'POST', body: JSON.stringify({ language: lang }) });
  },
  addNote(entityType: NoteEntity, entityId: string | number, text: string) {
    return request<Note>(`/notes`, {
      method: 'POST',
      body: JSON.stringify({ entity_type: entityType, entity_id: entityId, text }),
    });
  },
  async getNotes(entityType: NoteEntity, entityId: string | number): Promise<Note[]> {
    const query = queryString({ entity_type: entityType, entity_id: entityId });
    return unwrapList<Note>(await request<unknown>(`/notes${query}`), ['rows', 'items', 'notes']);
  },
  updateNote(id: Note['id'], text: string): Promise<Note> {
    return request(`/notes/${encodeURIComponent(String(id))}`, { method: 'PATCH', body: JSON.stringify({ text }) });
  },
  deleteNote(id: Note['id']): Promise<void> {
    return request(`/notes/${encodeURIComponent(String(id))}`, { method: 'DELETE' });
  },
  async getVocabulary(): Promise<VocabularyTerm[]> {
    return unwrapList<VocabularyTerm>(await request<unknown>('/begrepp'), ['rows', 'items', 'begrepp', 'data']);
  },
  createVocabularyTerm(input: Partial<VocabularyTerm>): Promise<VocabularyTerm> {
    return request('/begrepp', { method: 'POST', body: JSON.stringify(input) });
  },
  updateVocabularyTerm(id: VocabularyTerm['id'], input: Partial<VocabularyTerm>): Promise<VocabularyTerm> {
    return request(`/begrepp/${encodeURIComponent(String(id))}`, { method: 'PATCH', body: JSON.stringify(input) });
  },
  deleteVocabularyTerm(id: VocabularyTerm['id']): Promise<void> {
    return request(`/begrepp/${encodeURIComponent(String(id))}`, { method: 'DELETE' });
  },
  async getCollectionQuestions(): Promise<CollectionQuestion[]> {
    return unwrapList<CollectionQuestion>(await request<unknown>('/spaningsfragor'), ['rows', 'items', 'questions', 'spaningsfragor']);
  },
  createCollectionQuestion(input: Partial<CollectionQuestion>): Promise<CollectionQuestion> {
    return request('/spaningsfragor', { method: 'POST', body: JSON.stringify(input) });
  },
  updateCollectionQuestion(id: CollectionQuestion['id'], input: Partial<CollectionQuestion>): Promise<CollectionQuestion> {
    return request(`/spaningsfragor/${encodeURIComponent(String(id))}`, { method: 'PATCH', body: JSON.stringify(input) });
  },
  getSettings(): Promise<Partial<Settings>> {
    return request('/settings');
  },
  updateSettings(input: Partial<Settings>): Promise<Settings> {
    return request('/settings', { method: 'PATCH', body: JSON.stringify(input) });
  },
  async getLlmStatus(): Promise<LlmStatus> {
    const value = await request<{ ok?: boolean; state?: string; error_code?: string; models?: Array<{ id?: string; name?: string }> }>('/llm/status');
    return {
      status: value.ok || value.state === 'ready' ? 'online' : value.state === 'starting' ? 'starting' : 'offline',
      model: value.models?.[0]?.id ?? value.models?.[0]?.name,
      detail: value.error_code,
    };
  },
  async getModels(): Promise<string[]> {
    const value = await request<{ files?: Array<string | { path?: string; name?: string }> }>('/llm/models');
    return (value.files ?? []).map((file) => {
      if (typeof file === 'string') return file;
      return file.name ? `llm/models/${file.name}` : '';
    }).filter(Boolean);
  },
  async getJobs(): Promise<AiJob[]> {
    const rows = unwrapList<BackendJob>(await request<unknown>('/ai/jobs'), ['rows', 'jobs', 'items']);
    return rows.map(normalizeJob);
  },
  cancelJob(id: AiJob['id']): Promise<void> {
    return request(`/ai/jobs/${encodeURIComponent(String(id))}`, { method: 'DELETE' });
  },
  async extract(text: string, lang: string): Promise<{ reports: ExtractedReport[]; drafts?: Array<Partial<IntelCase>>; reason?: string | null }> {
    const job = await request<BackendJob>('/ai/extract', { method: 'POST', body: JSON.stringify({ text, language: lang }) });
    return await waitForJob<{ reports: ExtractedReport[]; drafts?: Array<Partial<IntelCase>>; reason?: string | null }>(job);
  },
  async ask(question: string, lang: string, filters?: unknown): Promise<AskAnswer> {
    const job = await request<BackendJob>('/ai/ask', { method: 'POST', body: JSON.stringify({ question, language: lang, filters: backendFilters(filters) }) });
    return await waitForJob<AskAnswer>(job);
  },
  async assess(caseIds: Array<IntelCase['id']>, lang: string): Promise<Assessment> {
    const job = await request<BackendJob>('/ai/assess', { method: 'POST', body: JSON.stringify({ case_ids: caseIds, language: lang }) });
    return await waitForJob<Assessment>(job);
  },
  async generateCollectionQuestions(lang: string): Promise<CollectionQuestion[]> {
    const job = await request<BackendJob>('/spaningsfragor/generate', {
      method: 'POST',
      body: JSON.stringify({ language: lang }),
    });
    const result = await waitForJob<unknown>(job);
    return unwrapList<CollectionQuestion>(result, ['rows', 'items', 'questions', 'spaningsfragor', 'proposals']);
  },
  async previewImport(file: File, mapping?: Record<string, string>): Promise<ImportPreview> {
    const buffer = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < buffer.length; offset += 0x8000) {
      binary += String.fromCharCode(...buffer.subarray(offset, offset + 0x8000));
    }
    return request('/imports/preview', {
      method: 'POST',
      body: JSON.stringify({ filename: file.name, file_base64: btoa(binary), ...(mapping ? { mapping } : {}) }),
    });
  },
  applyImport(token: string, mode: 'replace' | 'merge' | 'append', mapping: Record<string, string>): Promise<ImportApplyResult> {
    return request('/imports/apply', { method: 'POST', body: JSON.stringify({ token, mode, mapping }) });
  },
  exportUrl(format: 'xlsx' | 'csv', caseIds?: Array<IntelCase['id']>, separator?: ';' | ',') {
    return `${API_ROOT}/exports/${format}${queryString({
      case_ids: caseIds?.length ? caseIds.join(',') : undefined,
      delimiter: format === 'csv' && separator === ',' ? 'comma' : undefined,
    })}`;
  },
  exportVocabularyUrl() {
    return `${API_ROOT}/begrepp/export`;
  },
  async importVocabulary(file: File): Promise<VocabularyTerm[]> {
    const parsed: unknown = JSON.parse(await file.text());
    const result = await request<unknown>('/begrepp/import', { method: 'POST', body: JSON.stringify(parsed) });
    return unwrapList<VocabularyTerm>(result, ['rows', 'begrepp', 'items']);
  },
  wipe(_confirm: string): Promise<void> {
    return request('/admin/wipe', { method: 'POST', body: JSON.stringify({ confirmed: true, confirmation: 'AURORA' }) });
  },
  clearLogs(): Promise<void> {
    return request('/logs', { method: 'DELETE' });
  },
};

type NoteEntity = 'case' | 'begrepp' | 'spaningsfraga';

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface BackendJob {
  id: string | number;
  type: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  result?: unknown;
  error_code?: string;
  created_at?: string;
}

function normalizeJob(job: BackendJob): AiJob {
  const types: Record<string, AiJob['type']> = {
    extraction: 'extract',
    questions: 'collection_questions',
    qa: 'ask',
    assessment: 'assess',
  };
  return { ...job, type: types[job.type] ?? job.type, error: job.error_code };
}

async function waitForJob<T>(initial: BackendJob): Promise<T> {
  let job = initial;
  const deadline = Date.now() + 10 * 60_000;
  while ((job.status === 'pending' || job.status === 'running') && Date.now() < deadline) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 650));
    job = await request<BackendJob>(`/ai/jobs/${encodeURIComponent(String(job.id))}`);
  }
  if (job.status === 'done') return job.result as T;
  if (Date.now() >= deadline) throw new Error('The local AI job timed out.');
  throw new Error(job.error_code ?? `AI job ${job.status}`);
}

function backendFilters(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  return {
    q: source.query || undefined,
    from: source.dateFrom || undefined,
    to: source.dateTo || undefined,
    status: source.status || undefined,
    aktor: source.actor || undefined,
    begrepp: source.vocabulary || undefined,
    tags: source.tag || undefined,
    star: source.starOnly || undefined,
    position_missing: source.missingPosition || undefined,
    bbox: Array.isArray(source.bbox) && source.bbox.length === 4 ? source.bbox : undefined,
  };
}
