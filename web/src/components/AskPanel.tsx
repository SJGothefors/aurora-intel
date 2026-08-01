import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, describeError } from '../api';
import type { AskAnswer, IntelCase, LlmStatus } from '../types';

interface AskPanelProps {
  cases: IntelCase[];
  llm: LlmStatus;
  filters: unknown;
  answer: AskAnswer | null;
  onAnswer: (answer: AskAnswer | null) => void;
  onCitations: (ids: Array<IntelCase['id']>) => void;
  onOpenCase: (item: IntelCase) => void;
  onError: (message: string) => void;
}

export function AskPanel({ cases, llm, filters, answer, onAnswer, onCitations, onOpenCase, onError }: AskPanelProps) {
  const { t, i18n } = useTranslation();
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const aiReady = llm.status === 'online';
  const cited = answer ? answer.cited_case_ids.map((id) => cases.find((item) => String(item.id) === String(id))).filter((item): item is IntelCase => Boolean(item)) : [];

  const ask = async () => {
    if (!question.trim() || !aiReady) return;
    setBusy(true);
    try {
      const result = await api.ask(question.trim(), i18n.language, filters);
      onAnswer(result);
      onCitations(result.cited_case_ids);
    } catch (error) {
      onError(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="work-panel-content ask-panel">
      <div className="panel-intro"><span className="eyebrow">{t('ask.eyebrow')}</span><h2>{t('ask.title')}</h2><p>{t('ask.intro')}</p></div>
      {!aiReady && <div className="notice-card warning-notice"><span className="notice-glyph" aria-hidden="true">!</span><div><strong>{t('llm.unavailableTitle')}</strong><p>{t('llm.unavailableHint')}</p></div></div>}
      <form className="ask-form" onSubmit={(event) => { event.preventDefault(); void ask(); }}>
        <label><span>{t('ask.label')}</span><textarea rows={5} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={t('ask.placeholder')} /></label>
        <button className="primary-button" type="submit" disabled={!question.trim() || !aiReady || busy}>{busy && <span className="spinner" />}{busy ? t('ask.thinking') : t('ask.submit')}</button>
      </form>

      {busy && (
        <div className="analysis-progress" role="status"><div className="radar-glyph" aria-hidden="true"><i /></div><strong>{t('ask.thinking')}</strong><span>{t('jobs.running')}</span></div>
      )}
      {!busy && !answer && (
        <div className="empty-state compact-empty"><span className="empty-glyph" aria-hidden="true">?</span><strong>{t('ask.emptyTitle')}</strong><p>{t('ask.emptyBody')}</p></div>
      )}
      {answer && !busy && (
        <article className="ai-answer">
          <header><span className="eyebrow">{t('ask.answer')}</span><button className="text-button" type="button" onClick={() => { onAnswer(null); onCitations([]); }}>{t('ask.clearAnswer')}</button></header>
          <p>{answer.answer}</p>
          {answer.pattern?.type && <div className="pattern-callout"><span aria-hidden="true">⌁</span><div><strong>{t('ask.pattern')} · {answer.pattern.type.toLocaleUpperCase()}</strong><p>{answer.pattern.description}</p></div></div>}
          <div className="citation-block">
            <div className="citation-heading"><span className="eyebrow">{t('ask.sources')}</span>{cited.length > 1 && <button className="text-button" type="button" onClick={() => onCitations(answer.cited_case_ids)}>{t('ask.highlightSources')}</button>}</div>
            {cited.length ? cited.map((item) => (
              <button className="citation-row" type="button" key={item.id} onClick={() => { onCitations([item.id]); onOpenCase(item); }}>
                <span className="citation-index">#{item.lopnr}</span>
                <span><strong>{item.slag ?? item.begrepp[0] ?? t('app.notAvailable')}</strong><small>{item.place_name ?? item.mgrs ?? t('ledger.missingPosition')}</small></span>
                <span aria-hidden="true">→</span>
              </button>
            )) : <p className="insufficient-evidence">{t('ask.insufficient')}</p>}
          </div>
        </article>
      )}
    </div>
  );
}
