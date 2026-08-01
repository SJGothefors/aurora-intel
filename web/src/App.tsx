import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, describeError } from './api';
import type {
  AiJob,
  AppDialog,
  AskAnswer,
  Assessment,
  CaseFilters,
  CollectionQuestion,
  IntelCase,
  ImportApplyResult,
  ImportPreview,
  LlmStatus,
  PanelTab,
  Settings,
  VocabularyTerm,
} from './types';
import { DEFAULT_FILTERS, DEFAULT_SETTINGS } from './types';
import { activeFilterCount, clamp } from './utils';
import { AiQueue } from './components/AiQueue';
import { AskPanel } from './components/AskPanel';
import { CaseDetail } from './components/CaseDetail';
import { FiltersBar } from './components/FiltersBar';
import { IntakePanel } from './components/IntakePanel';
import { LedgerTable } from './components/LedgerTable';
import { MapPanel } from './components/MapPanel';
import { Modal } from './components/Modal';
import { PositionDialog } from './components/PositionDialog';
import { QuestionsPanel } from './components/QuestionsPanel';
import { SettingsDialog } from './components/SettingsDialog';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import { TransferDialog } from './components/TransferDialog';
import { VocabularyDialog } from './components/VocabularyDialog';

type Bounds = { north: number; south: number; east: number; west: number };

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try { const parsed: unknown = JSON.parse(value); if (Array.isArray(parsed)) return parsed.map(String); } catch { /* CSV-style fallback below. */ }
    return value.split(',').map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

function normalizeCase(item: IntelCase): IntelCase {
  return {
    ...item,
    star: Boolean(item.star),
    time_uncertain: Boolean(item.time_uncertain),
    position_missing: Boolean(item.position_missing),
    tags: asArray(item.tags),
    begrepp: asArray(item.begrepp),
    fields_uncertain: asArray(item.fields_uncertain),
    notes: Array.isArray(item.notes) ? item.notes : [],
  };
}

function normalizeQuestion(item: CollectionQuestion): CollectionQuestion {
  return { ...item, linked_case_ids: asArray(item.linked_case_ids) };
}

export function App() {
  const { t, i18n } = useTranslation();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const splitRef = useRef<HTMLDivElement | null>(null);
  const [cases, setCases] = useState<IntelCase[]>([]);
  const [vocabulary, setVocabulary] = useState<VocabularyTerm[]>([]);
  const [questions, setQuestions] = useState<CollectionQuestion[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [models, setModels] = useState<string[]>([]);
  const [llm, setLlm] = useState<LlmStatus>({ status: 'starting' });
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [filters, setFilters] = useState<CaseFilters>(DEFAULT_FILTERS);
  const [groupBy, setGroupBy] = useState('');
  const [mapBounds, setMapBounds] = useState<Bounds | null>(null);
  const [selectedId, setSelectedId] = useState<IntelCase['id'] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [hoveredId, setHoveredId] = useState<IntelCase['id'] | null>(null);
  const [citedIds, setCitedIds] = useState<Array<IntelCase['id']>>([]);
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>('intake');
  const [panelOpen, setPanelOpen] = useState(true);
  const [dialog, setDialog] = useState<AppDialog>(null);
  const [positionCase, setPositionCase] = useState<IntelCase | null>(null);
  const [split, setSplit] = useState(57);
  const [loading, setLoading] = useState(true);
  const [apiOffline, setApiOffline] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [bulkAssessment, setBulkAssessment] = useState<Assessment | null>(null);
  const [bulkAssessing, setBulkAssessing] = useState(false);
  const [bulkAssessmentIds, setBulkAssessmentIds] = useState<Array<IntelCase['id']>>([]);
  const [bulkAssessmentSaving, setBulkAssessmentSaving] = useState(false);
  const [searchResult, setSearchResult] = useState<{ query: string; rows: IntelCase[] } | null>(null);
  const [searchPending, setSearchPending] = useState(false);
  const [searchEpoch, setSearchEpoch] = useState(0);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => current === message ? null : current), 4200);
  }, []);
  const reportError = useCallback((message: string) => notify(t('toast.errorPrefix', { message })), [notify, t]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [caseResult, vocabularyResult, questionResult, settingsResult, statusResult, modelResult, jobResult] = await Promise.allSettled([
      api.getCases(), api.getVocabulary(), api.getCollectionQuestions(), api.getSettings(), api.getLlmStatus(), api.getModels(), api.getJobs(),
    ]);
    if (caseResult.status === 'fulfilled') { setCases(caseResult.value.map(normalizeCase)); setApiOffline(false); } else { setApiOffline(true); }
    if (vocabularyResult.status === 'fulfilled') setVocabulary(vocabularyResult.value);
    if (questionResult.status === 'fulfilled') setQuestions(questionResult.value.map(normalizeQuestion));
    if (settingsResult.status === 'fulfilled') {
      const next = { ...DEFAULT_SETTINGS, ...settingsResult.value };
      setSettings(next);
      await i18n.changeLanguage(next.lang);
    }
    setLlm(statusResult.status === 'fulfilled' ? statusResult.value : { status: 'offline' });
    if (modelResult.status === 'fulfilled') setModels(modelResult.value);
    if (jobResult.status === 'fulfilled') setJobs(jobResult.value);
    setLoading(false);
  }, [i18n]);

  useEffect(() => { void loadAll(); }, [loadAll]);
  useEffect(() => {
    const id = window.setInterval(async () => {
      const [statusResult, jobsResult] = await Promise.allSettled([api.getLlmStatus(), api.getJobs()]);
      setLlm(statusResult.status === 'fulfilled' ? statusResult.value : { status: 'offline' });
      if (jobsResult.status === 'fulfilled') setJobs(jobsResult.value);
    }, 5000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    document.documentElement.lang = settings.lang;
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.density = settings.density;
    document.documentElement.style.setProperty('--accent', settings.accent || '#f0568c');
  }, [settings]);
  useEffect(() => {
    if (selectedId == null) return;
    let cancelled = false;
    void api.getNotes('case', selectedId).then((notes) => {
      if (cancelled) return;
      setCases((current) => current.map((item) => String(item.id) === String(selectedId) ? { ...item, notes } : item));
    }).catch(() => { /* The detail view remains usable if notes cannot be refreshed. */ });
    return () => { cancelled = true; };
  }, [selectedId]);
  useEffect(() => {
    const query = filters.query.trim();
    if (!query) {
      setSearchResult(null);
      setSearchPending(false);
      return;
    }
    const controller = new AbortController();
    setSearchPending(true);
    const timeout = window.setTimeout(() => {
      void api.getCases({ q: query, signal: controller.signal }).then((rows) => {
        if (!controller.signal.aborted) setSearchResult({ query, rows: rows.map(normalizeCase) });
      }).catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) reportError(describeError(error));
      }).finally(() => {
        if (!controller.signal.aborted) setSearchPending(false);
      });
    }, 220);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [filters.query, reportError, searchEpoch]);

  const searchQuery = filters.query.trim();
  const searchedCases = searchQuery
    ? searchResult?.query === searchQuery ? searchResult.rows : []
    : cases;
  const filteredCases = useMemo(() => searchedCases.filter((item) => {
    if (filters.status && item.status !== filters.status) return false;
    if (filters.actor && item.aktor !== filters.actor) return false;
    if (filters.vocabulary && !item.begrepp.includes(filters.vocabulary)) return false;
    if (filters.tag && !item.tags.includes(filters.tag)) return false;
    if (filters.starOnly && !item.star) return false;
    if (filters.missingPosition && !item.position_missing) return false;
    const day = item.time_utc?.slice(0, 10) ?? '';
    if (filters.dateFrom && (!day || day < filters.dateFrom)) return false;
    if (filters.dateTo && (!day || day > filters.dateTo)) return false;
    if (filters.mapExtentOnly && mapBounds) {
      if (item.lat == null || item.lon == null) return false;
      if (item.lat > mapBounds.north || item.lat < mapBounds.south || item.lon > mapBounds.east || item.lon < mapBounds.west) return false;
    }
    return true;
  }), [filters, mapBounds, searchedCases]);
  const aiFilters = useMemo(() => ({
    ...filters,
    bbox: filters.mapExtentOnly && mapBounds
      ? [mapBounds.west, mapBounds.south, mapBounds.east, mapBounds.north]
      : undefined,
  }), [filters, mapBounds]);

  const selectedCase = useMemo(() => cases.find((item) => String(item.id) === String(selectedId)) ?? null, [cases, selectedId]);
  const allTags = useMemo(() => [...new Set(cases.flatMap((item) => item.tags))].sort((a, b) => a.localeCompare(b, 'sv')), [cases]);

  const createCase = useCallback(async (input: Partial<IntelCase>) => {
    try {
      const saved = normalizeCase(await api.createCase(input));
      setCases((current) => [saved, ...current.filter((item) => String(item.id) !== String(saved.id))]);
      setSearchEpoch((value) => value + 1);
      setSelectedId(saved.id);
      notify(t('toast.caseSaved'));
    } catch (error) { reportError(describeError(error)); throw error; }
  }, [notify, reportError, t]);

  const updateCase = useCallback(async (item: IntelCase, patch: Partial<IntelCase>) => {
    try {
      const response = await api.updateCase(item.id, patch);
      const saved = normalizeCase({ ...item, ...patch, ...response });
      setCases((current) => current.map((candidate) => String(candidate.id) === String(item.id) ? saved : candidate));
      setSearchEpoch((value) => value + 1);
      notify(t('toast.caseUpdated'));
    } catch (error) { reportError(describeError(error)); throw error; }
  }, [notify, reportError, t]);

  const deleteCase = useCallback(async (item: IntelCase) => {
    try {
      await api.deleteCase(item.id);
      setCases((current) => current.filter((candidate) => String(candidate.id) !== String(item.id)));
      setSearchEpoch((value) => value + 1);
      setSelectedId(null);
      setSelectedIds((current) => { const next = new Set(current); next.delete(String(item.id)); return next; });
      notify(t('toast.caseDeleted'));
    } catch (error) { reportError(describeError(error)); throw error; }
  }, [notify, reportError, t]);

  const assess = useCallback(async (item: IntelCase) => {
    try { return await api.assess([item.id], i18n.language); } catch (error) { reportError(describeError(error)); throw error; }
  }, [i18n.language, reportError]);

  const assessSelection = useCallback(async () => {
    if (!selectedIds.size || llm.status !== 'online') return;
    const caseIds = [...selectedIds];
    setBulkAssessmentIds(caseIds);
    setBulkAssessment(null);
    setBulkAssessing(true);
    try { setBulkAssessment(await api.assess(caseIds, i18n.language)); } catch (error) { reportError(describeError(error)); } finally { setBulkAssessing(false); }
  }, [i18n.language, llm.status, reportError, selectedIds]);

  const saveBulkAssessment = useCallback(async () => {
    if (!bulkAssessment || !bulkAssessmentIds.length || bulkAssessmentSaving) return;
    const targetIds = new Set(bulkAssessmentIds.map(String));
    const targets = cases.filter((item) => targetIds.has(String(item.id)));
    if (!targets.length) return;
    const text = `${t('detail.fact')}: ${bulkAssessment.fakta}\n\n${t('detail.judgement')} (${bulkAssessment.sannolikhet}): ${bulkAssessment.bedomning}\n\n${t('detail.reasoning')}: ${bulkAssessment.motivering}\n\n${t('detail.recommendation')}: ${bulkAssessment.rekommendation}`;
    setBulkAssessmentSaving(true);
    try {
      const saved = await Promise.all(targets.map((item) => api.updateCase(item.id, { bedomning: text })));
      const byId = new Map(saved.map((item) => [String(item.id), normalizeCase(item)]));
      setCases((current) => current.map((item) => byId.get(String(item.id)) ?? item));
      setSearchEpoch((value) => value + 1);
      notify(t('toast.assessmentSavedCount', { count: saved.length }));
      setBulkAssessment(null);
      setBulkAssessmentIds([]);
    } catch (error) {
      try { setCases((await api.getCases()).map(normalizeCase)); } catch { /* Keep the last known rows if reconciliation also fails. */ }
      reportError(describeError(error));
    } finally {
      setBulkAssessmentSaving(false);
    }
  }, [bulkAssessment, bulkAssessmentIds, bulkAssessmentSaving, cases, notify, reportError, t]);

  const saveSettings = async (next: Settings) => {
    try {
      const saved = { ...next, ...await api.updateSettings(next) };
      setSettings(saved);
      await i18n.changeLanguage(saved.lang);
      notify(t('toast.settingsSaved'));
    } catch (error) { reportError(describeError(error)); throw error; }
  };
  const wipe = async (phrase: string) => {
    triggerExport('xlsx', 'all', ';');
    await api.wipe(phrase);
    setCases([]); setQuestions([]); setSelectedId(null); setSelectedIds(new Set());
    setSearchEpoch((value) => value + 1);
  };
  const triggerExport = (format: 'xlsx' | 'csv', scope: 'all' | 'filtered', separator: ';' | ',') => {
    const anchor = document.createElement('a');
    anchor.href = api.exportUrl(format, scope === 'filtered' ? filteredCases.map((item) => item.id) : undefined, separator);
    anchor.download = '';
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    notify(t('toast.exportStarted'));
  };
  const previewImport = async (file: File, mapping?: Record<string, string>): Promise<ImportPreview> => {
    try { return await api.previewImport(file, mapping); } catch (error) { reportError(describeError(error)); throw error; }
  };
  const applyImport = async (token: string, mode: 'replace' | 'merge' | 'append', mapping: Record<string, string>): Promise<ImportApplyResult> => {
    try {
      const result = await api.applyImport(token, mode, mapping);
      const [nextCases, nextQuestions, nextVocabulary] = await Promise.all([api.getCases(), api.getCollectionQuestions(), api.getVocabulary()]);
      setCases(nextCases.map(normalizeCase));
      setQuestions(nextQuestions.map(normalizeQuestion));
      setVocabulary(nextVocabulary);
      setSearchEpoch((value) => value + 1);
      notify(t('toast.importComplete'));
      return result;
    } catch (error) { reportError(describeError(error)); throw error; }
  };
  const createTerm = async (term: Partial<VocabularyTerm>) => {
    try { const saved = await api.createVocabularyTerm(term); setVocabulary((current) => [...current, saved]); notify(t('toast.termSaved')); } catch (error) { reportError(describeError(error)); throw error; }
  };
  const updateTerm = async (term: VocabularyTerm, patch: Partial<VocabularyTerm>) => {
    try { const saved = await api.updateVocabularyTerm(term.id, patch); setVocabulary((current) => current.map((candidate) => String(candidate.id) === String(term.id) ? { ...candidate, ...patch, ...saved } : candidate)); setSearchEpoch((value) => value + 1); } catch (error) { reportError(describeError(error)); throw error; }
  };
  const deleteTerm = async (term: VocabularyTerm) => {
    try { await api.deleteVocabularyTerm(term.id); setVocabulary((current) => current.filter((candidate) => String(candidate.id) !== String(term.id))); notify(t('toast.termDeleted')); } catch (error) { reportError(describeError(error)); throw error; }
  };
  const importTerms = async (file: File) => {
    try { const saved = await api.importVocabulary(file); setVocabulary(saved); notify(t('toast.termSaved')); } catch (error) { reportError(describeError(error)); throw error; }
  };

  const toggleSelected = (item: IntelCase) => setSelectedIds((current) => { const next = new Set(current); const id = String(item.id); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleAll = () => setSelectedIds((current) => filteredCases.length && filteredCases.every((item) => current.has(String(item.id))) ? new Set() : new Set(filteredCases.map((item) => String(item.id))));
  const openCase = (item: IntelCase) => setSelectedId(item.id);
  const openIntake = () => { setPanelTab('intake'); setPanelOpen(true); };
  const openMissing = () => setFilters((current) => ({ ...current, missingPosition: true }));
  const onSplitterDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const container = splitRef.current;
    if (!container) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      setSplit(clamp(((moveEvent.clientX - rect.left) / rect.width) * 100, 35, 72));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.matches('input, textarea, select, [contenteditable="true"]');
      if (event.key === 'Escape') { if (dialog) setDialog(null); else if (selectedId) setSelectedId(null); return; }
      if (typing) return;
      if (event.key === '/') { event.preventDefault(); searchRef.current?.focus(); }
      if (event.key.toLocaleLowerCase() === 'n') { event.preventDefault(); openIntake(); }
      if (event.key.toLocaleLowerCase() === 's' && selectedCase) { event.preventDefault(); void updateCase(selectedCase, { star: !selectedCase.star }); }
      if (event.key === '?') { event.preventDefault(); setDialog('shortcuts'); }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [dialog, selectedCase, selectedId, updateCase]);

  return (
    <div className="app-shell" style={{ '--split': `${split}%` } as CSSProperties}>
      <div className="classification-banner"><span className="banner-mark" aria-hidden="true" />{settings.bannerText || t('app.classification')}<span className="banner-local"><i />{t('app.localOnly')}</span></div>
      <header className="topbar">
        <button className="wordmark" type="button" onClick={() => { setFilters(DEFAULT_FILTERS); setSelectedId(null); }}><span className="wordmark-a">A</span><span><strong>{t('app.name')}</strong><small>{t('app.subtitle')}</small></span></button>
        <label className="global-search"><span aria-hidden="true">⌕</span><input ref={searchRef} value={filters.query} onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))} placeholder={t('header.searchPlaceholder')} aria-label={t('header.searchLabel')} />{searchPending && <i className="search-progress" role="status" title={t('header.searching')} />}<kbd>/</kbd>{filters.query && <button type="button" aria-label={t('intake.clear')} onClick={() => setFilters((current) => ({ ...current, query: '' }))}>×</button>}</label>
        <div className="topbar-actions">
          <button className={`llm-status status-${llm.status}`} type="button" title={llm.detail ?? t(`llm.${llm.status}`)} onClick={() => setDialog('settings')}><i /><span><small>{t('llm.label')}</small><strong>{t(`llm.${llm.status}`)}</strong></span></button>
          <button className="new-case-button" type="button" onClick={openIntake}><span aria-hidden="true">＋</span>{t('header.newCase')}<kbd>N</kbd></button>
          <button className="icon-button top-icon" type="button" title={t('header.importExport')} aria-label={t('header.importExport')} onClick={() => setDialog('importExport')}><span aria-hidden="true">⇅</span></button>
          <button className="icon-button top-icon" type="button" title={t('header.vocabulary')} aria-label={t('header.vocabulary')} onClick={() => setDialog('vocabulary')}><span aria-hidden="true">≣</span></button>
          <button className="language-button" type="button" title={t('header.toggleLanguage')} aria-label={t('header.toggleLanguage')} onClick={() => void saveSettings({ ...settings, lang: settings.lang === 'sv' ? 'en' : 'sv' })}>{settings.lang.toUpperCase()}</button>
          <button className="icon-button top-icon" type="button" title={t('header.toggleTheme')} aria-label={t('header.toggleTheme')} onClick={() => void saveSettings({ ...settings, theme: settings.theme === 'dark' ? 'light' : 'dark' })}><span aria-hidden="true">◐</span></button>
          <button className="icon-button top-icon" type="button" title={t('header.settings')} aria-label={t('header.settings')} onClick={() => setDialog('settings')}><span aria-hidden="true">⚙</span></button>
        </div>
      </header>
      <FiltersBar filters={filters} cases={cases} vocabulary={vocabulary} onChange={setFilters} onReset={() => setFilters(DEFAULT_FILTERS)} />
      {apiOffline && <div className="api-offline-banner"><span aria-hidden="true">!</span><p>{t('app.offlineApi')}</p><button type="button" onClick={() => void loadAll()}>{t('app.retry')}</button></div>}

      <main className={`main-layout${panelOpen ? '' : ' panel-collapsed'}`}>
        <div className="split-workspace" ref={splitRef}>
          <div className="split-pane ledger-side">
            <LedgerTable
              cases={filteredCases}
              totalCount={cases.length}
              selectedId={selectedId}
              selectedIds={selectedIds}
              hoveredId={hoveredId}
              citedIds={citedIds}
              groupBy={groupBy}
              hasFilters={activeFilterCount(filters) > 0}
              assessmentAvailable={llm.status === 'online'}
              onGroupBy={setGroupBy}
              onSelect={openCase}
              onHover={setHoveredId}
              onToggleSelected={toggleSelected}
              onToggleAll={toggleAll}
              onToggleStar={(item) => void updateCase(item, { star: !item.star })}
              onUpdate={(item, patch) => void updateCase(item, patch)}
              onAddPosition={setPositionCase}
              onNewCase={openIntake}
              onClearFilters={() => setFilters(DEFAULT_FILTERS)}
              onAssessSelection={() => void assessSelection()}
            />
          </div>
          <div className="splitter" role="separator" aria-orientation="vertical" aria-label={t('ledger.resize')} onPointerDown={onSplitterDown}><i /><i /><i /></div>
          <div className="split-pane map-side">
            <MapPanel cases={filteredCases} vocabulary={vocabulary} selectedId={selectedId} hoveredId={hoveredId} citedIds={citedIds} answerPattern={answer?.pattern} onSelect={openCase} onHover={setHoveredId} onExtentChange={setMapBounds} onShowMissing={openMissing} />
          </div>
        </div>

        <aside className="work-panel" aria-label={t('panel.workspace')}>
          <div className="work-panel-tabs" role="tablist">
            {(['intake', 'ask', 'questions'] as const).map((tab) => <button key={tab} type="button" role="tab" aria-selected={panelTab === tab} className={panelTab === tab ? 'is-active' : ''} onClick={() => setPanelTab(tab)}><span aria-hidden="true">{tab === 'intake' ? '＋' : tab === 'ask' ? '?' : '◎'}</span>{t(`panel.${tab}`)}{tab === 'questions' && questions.filter((item) => item.status === 'Föreslagen').length > 0 && <b>{questions.filter((item) => item.status === 'Föreslagen').length}</b>}</button>)}
            <button className="panel-close" type="button" title={t('panel.collapse')} aria-label={t('panel.collapse')} onClick={() => setPanelOpen(false)}>›</button>
          </div>
          {panelTab === 'intake' && <IntakePanel llm={llm} vocabulary={vocabulary} tagSuggestions={allTags} onCreate={createCase} onError={reportError} />}
          {panelTab === 'ask' && <AskPanel cases={cases} llm={llm} filters={aiFilters} answer={answer} onAnswer={setAnswer} onCitations={setCitedIds} onOpenCase={openCase} onError={reportError} />}
          {panelTab === 'questions' && <QuestionsPanel cases={cases} questions={questions} llm={llm} trigger={settings.spaningsfragaTrigger} onQuestions={setQuestions} onOpenCase={openCase} onNotify={notify} onError={reportError} />}
        </aside>
        {!panelOpen && <button className="panel-expand" type="button" title={t('panel.expand')} aria-label={t('panel.expand')} onClick={() => setPanelOpen(true)}><span>‹</span><small>{t(`panel.${panelTab}`)}</small></button>}
      </main>

      <AiQueue jobs={jobs} onCancel={(job) => void api.cancelJob(job.id).then(() => { setJobs((current) => current.map((item) => String(item.id) === String(job.id) ? { ...item, status: 'cancelled' } : item)); notify(t('toast.jobCancelled')); }).catch((error) => reportError(describeError(error)))} />
      <CaseDetail item={selectedCase} vocabulary={vocabulary} tagSuggestions={allTags} llm={llm} cited={selectedCase ? citedIds.map(String).includes(String(selectedCase.id)) : false} onClose={() => setSelectedId(null)} onUpdate={updateCase} onDelete={deleteCase} onNotesChange={(item, notes) => setCases((current) => current.map((candidate) => String(candidate.id) === String(item.id) ? { ...candidate, notes } : candidate))} onNotify={notify} onError={reportError} onAssess={assess} onAddPosition={setPositionCase} />
      <PositionDialog item={positionCase} onClose={() => setPositionCase(null)} onSave={updateCase} />
      <SettingsDialog open={dialog === 'settings'} settings={settings} models={models} llm={llm} onClose={() => setDialog(null)} onSave={saveSettings} onWipe={wipe} onClearLogs={async () => { try { await api.clearLogs(); notify(t('toast.logsCleared')); } catch (error) { reportError(describeError(error)); } }} />
      <VocabularyDialog open={dialog === 'vocabulary'} terms={vocabulary} onClose={() => setDialog(null)} onCreate={createTerm} onUpdate={updateTerm} onDelete={deleteTerm} onImport={importTerms} exportUrl={api.exportVocabularyUrl()} onNotify={notify} onError={reportError} />
      <TransferDialog open={dialog === 'importExport'} filteredCount={filteredCases.length} totalCount={cases.length} onClose={() => setDialog(null)} onExport={triggerExport} onPreview={previewImport} onApply={applyImport} />
      <ShortcutsDialog open={dialog === 'shortcuts'} onClose={() => setDialog(null)} />
      <Modal
        open={Boolean(bulkAssessment) || bulkAssessing}
        eyebrow={t('detail.assessment')}
        title={t('ledger.assessSelection')}
        onClose={() => {
          if (bulkAssessmentSaving) return;
          setBulkAssessment(null);
          setBulkAssessing(false);
          setBulkAssessmentIds([]);
        }}
        footer={bulkAssessment ? <><button className="quiet-button" type="button" disabled={bulkAssessmentSaving} onClick={() => { setBulkAssessment(null); setBulkAssessmentIds([]); }}>{t('app.close')}</button><button className="primary-button" type="button" disabled={bulkAssessmentSaving} onClick={() => void saveBulkAssessment()}>{bulkAssessmentSaving && <span className="spinner" />}{t('ledger.saveAssessmentToSelected', { count: bulkAssessmentIds.length })}</button></> : undefined}
      >
        {bulkAssessing ? <div className="analysis-progress"><div className="radar-glyph" aria-hidden="true"><i /></div><strong>{t('detail.assessing')}</strong></div> : bulkAssessment ? <div className="assessment-result"><section><span className="eyebrow">{t('detail.fact')}</span><p>{bulkAssessment.fakta}</p></section><section className="judgement-section"><span className="eyebrow">{t('detail.judgement')} · {bulkAssessment.sannolikhet.toLocaleUpperCase()}</span><p>{bulkAssessment.bedomning}</p></section><dl><div><dt>{t('detail.reasoning')}</dt><dd>{bulkAssessment.motivering}</dd></div><div><dt>{t('detail.recommendation')}</dt><dd>{bulkAssessment.rekommendation}</dd></div></dl><p className="bulk-assessment-save-hint">{t('ledger.bulkAssessmentSaveHint', { count: bulkAssessmentIds.length })}</p></div> : null}
      </Modal>
      {loading && <div className="initial-loader" role="status"><div className="aurora-loader"><i /><i /><i /></div><strong>{t('app.loading')}</strong></div>}
      {toast && <div className="toast" role="status"><span aria-hidden="true">✓</span>{toast}<button type="button" aria-label={t('app.close')} onClick={() => setToast(null)}>×</button></div>}
    </div>
  );
}
