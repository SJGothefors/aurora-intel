import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, describeError } from '../api';
import type { ExtractedReport, IntelCase, LlmStatus, VocabularyTerm } from '../types';
import { caseFromExtraction } from '../utils';
import { CaseForm } from './CaseForm';

interface IntakePanelProps {
  llm: LlmStatus;
  vocabulary: VocabularyTerm[];
  tagSuggestions: string[];
  onCreate: (input: Partial<IntelCase>) => Promise<void>;
  onError: (message: string) => void;
}

interface PreviewItem {
  key: string;
  report: ExtractedReport;
  draft: Partial<IntelCase>;
  saved: boolean;
}

function uncertaintyCount(draft: Partial<IntelCase>): number {
  const fields = new Set(draft.fields_uncertain ?? []);
  if (draft.time_uncertain) fields.add('stunden');
  return fields.size;
}

const BLANK: Partial<IntelCase> = {
  status: 'Ny',
  star: false,
  tags: [],
  begrepp: [],
  aktor: 'Okänd',
  time_uncertain: false,
  position_missing: true,
  fields_uncertain: [],
};

export function IntakePanel({ llm, vocabulary, tagSuggestions, onCreate, onError }: IntakePanelProps) {
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState<'paste' | 'manual'>('paste');
  const [text, setText] = useState('');
  const [manual, setManual] = useState<Partial<IntelCase>>({ ...BLANK });
  const [previews, setPreviews] = useState<PreviewItem[]>([]);
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const aiReady = llm.status === 'online';
  const canExtract = aiReady && text.trim().length > 2 && !busy;
  const activeCount = useMemo(() => vocabulary.filter((term) => term.active).length, [vocabulary]);

  const extract = async () => {
    setBusy(true);
    setReason(null);
    try {
      const result = await api.extract(text, i18n.language);
      const extractionEnvelope = { reports: result.reports, reason: result.reason ?? null };
      setPreviews(result.reports.map((report, index) => {
        const serverDraft = result.drafts?.[index];
        return {
          key: `${Date.now()}-${index}`,
          report,
          draft: {
            ...caseFromExtraction(report, text),
            ...serverDraft,
            ai_json: serverDraft?.ai_json ?? extractionEnvelope,
          },
          saved: false,
        };
      }));
      if (!result.reports.length) setReason(result.reason ?? t('intake.notReport'));
    } catch (error) {
      onError(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  const savePreview = async (key: string) => {
    const item = previews.find((candidate) => candidate.key === key);
    if (!item || item.saved) return;
    try {
      await onCreate(item.draft);
      setPreviews((current) => current.map((candidate) => candidate.key === key ? { ...candidate, saved: true } : candidate));
    } catch {
      // The parent action owns error presentation.
    }
  };

  const saveManual = async () => {
    try {
      await onCreate(manual);
      setManual({ ...BLANK });
    } catch {
      // The parent action owns error presentation.
    }
  };

  return (
    <div className="work-panel-content intake-panel">
      <div className="panel-intro">
        <span className="eyebrow">{t('intake.eyebrow')}</span>
        <h2>{t('intake.title')}</h2>
      </div>
      <div className="segmented-control two-up" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'paste'} className={mode === 'paste' ? 'is-active' : ''} onClick={() => setMode('paste')}>{t('intake.pasteMode')}</button>
        <button type="button" role="tab" aria-selected={mode === 'manual'} className={mode === 'manual' ? 'is-active' : ''} onClick={() => setMode('manual')}>{t('intake.manualMode')}</button>
      </div>

      {mode === 'paste' ? (
        <>
          {!aiReady && (
            <div className="notice-card warning-notice"><span className="notice-glyph" aria-hidden="true">!</span><div><strong>{t('llm.unavailableTitle')}</strong><p>{t('llm.unavailableHint')}</p><button className="text-button" type="button" onClick={() => setMode('manual')}>{t('intake.manualAlways')}</button></div></div>
          )}
          <label className="paste-field">
            <span>{t('intake.pasteLabel')}</span>
            <textarea rows={11} value={text} onChange={(event) => setText(event.target.value)} placeholder={t('intake.pastePlaceholder')} spellCheck="false" />
            <small><span aria-hidden="true">▣</span>{t('intake.privacy')} · {activeCount} {t('form.vocabulary').toLocaleLowerCase()}</small>
          </label>
          <div className="split-actions">
            <button className="quiet-button" type="button" disabled={!text} onClick={() => { setText(''); setPreviews([]); setReason(null); }}>{t('intake.clear')}</button>
            <button className="primary-button" type="button" disabled={!canExtract} title={!aiReady ? t('intake.aiRequired') : undefined} onClick={extract}>
              {busy && <span className="spinner" />}{busy ? t('intake.structuring') : t('intake.structure')}
            </button>
          </div>
          {reason && <div className="notice-card"><span className="notice-glyph" aria-hidden="true">?</span><div><strong>{t('intake.notReport')}</strong><p>{reason}</p><small>{t('intake.tryAsk')}</small></div></div>}
          {previews.length > 0 && (
            <div className="preview-list">
              <header><span className="eyebrow">{t('intake.previewTitle')}</span><p>{t('intake.previewBody')}</p></header>
              {previews.map((item, index) => (
                <details className={`preview-card${item.saved ? ' is-saved' : ''}`} open={!item.saved} key={item.key}>
                  <summary>
                    <span className="report-index">{String(index + 1).padStart(2, '0')}</span>
                    <span><strong>{item.report.summary_sv ?? item.report.summary_en ?? t('intake.report', { number: index + 1 })}</strong><small>{uncertaintyCount(item.draft) ? `${uncertaintyCount(item.draft)} ${t('intake.uncertain').toLocaleLowerCase()}` : '7S'}</small></span>
                    <span className={item.saved ? 'saved-chip' : 'draft-chip'}>{item.saved ? t('intake.savedReport') : t('app.edit')}</span>
                  </summary>
                  {!item.saved && (
                    <div className="preview-form-wrap">
                      <CaseForm
                        value={item.draft}
                        vocabulary={vocabulary}
                        tagSuggestions={tagSuggestions}
                        submitLabel={t('intake.saveReport')}
                        onChange={(draft) => setPreviews((current) => current.map((candidate) => candidate.key === item.key ? { ...candidate, draft } : candidate))}
                        onSubmit={() => void savePreview(item.key)}
                      />
                      <button className="text-button danger-text" type="button" onClick={() => setPreviews((current) => current.filter((candidate) => candidate.key !== item.key))}>{t('intake.discardReport')}</button>
                    </div>
                  )}
                </details>
              ))}
            </div>
          )}
        </>
      ) : (
        <CaseForm value={manual} vocabulary={vocabulary} tagSuggestions={tagSuggestions} submitLabel={t('intake.saveReport')} onChange={setManual} onSubmit={() => void saveManual()} />
      )}
    </div>
  );
}
