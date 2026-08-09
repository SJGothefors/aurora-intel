import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, describeError } from '../../api';
import type { CollectionQuestion, IntelCase, LlmStatus } from '../../types';
import { EntityNotes } from '../../components/common/EntityNotes';

interface QuestionsPanelProps {
  cases: IntelCase[];
  questions: CollectionQuestion[];
  llm: LlmStatus;
  trigger: number;
  onQuestions: (questions: CollectionQuestion[]) => void;
  onOpenCase: (item: IntelCase) => void;
  onNotify: (message: string) => void;
  onError: (message: string) => void;
}

type QuestionStatus = CollectionQuestion['status'];

export function QuestionsPanel({ cases, questions, llm, trigger, onQuestions, onOpenCase, onNotify, onError }: QuestionsPanelProps) {
  const { t, i18n } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<QuestionStatus | ''>('');
  const [busy, setBusy] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualQuestion, setManualQuestion] = useState('');
  const [manualReason, setManualReason] = useState('');
  const [editingId, setEditingId] = useState<CollectionQuestion['id'] | null>(null);
  const [editQuestion, setEditQuestion] = useState('');
  const [editReason, setEditReason] = useState('');
  const remaining = Math.max(0, trigger + 1 - cases.length);
  const visible = useMemo(() => questions.filter((item) => !statusFilter || item.status === statusFilter), [questions, statusFilter]);

  const generate = async () => {
    setBusy(true);
    try {
      const proposed = await api.generateCollectionQuestions(i18n.language);
      onQuestions([...proposed, ...questions.filter((item) => !proposed.some((proposal) => String(proposal.id) === String(item.id)))]);
    } catch (error) {
      onError(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  const update = async (item: CollectionQuestion, patch: Partial<CollectionQuestion>) => {
    try {
      const saved = await api.updateCollectionQuestion(item.id, patch);
      onQuestions(questions.map((candidate) => String(candidate.id) === String(item.id) ? { ...candidate, ...saved } : candidate));
      onNotify(t('toast.questionUpdated'));
    } catch (error) {
      onError(describeError(error));
    }
  };

  const createManual = async () => {
    if (!manualQuestion.trim()) return;
    try {
      const saved = await api.createCollectionQuestion({
        question: manualQuestion.trim(),
        motivering: manualReason.trim(),
        prioritet: 'Medel',
        status: 'Aktiv',
        linked_case_ids: [],
        created_by: 'user',
      });
      onQuestions([saved, ...questions]);
      setManualQuestion('');
      setManualReason('');
      setManualOpen(false);
    } catch (error) {
      onError(describeError(error));
    }
  };

  return (
    <div className="work-panel-content questions-panel">
      <div className="panel-intro"><span className="eyebrow">{t('questions.eyebrow')}</span><h2>{t('questions.title')}</h2><p>{t('questions.triggerHint', { count: trigger })}</p></div>
      <div className="question-actions">
        <button className="primary-button" type="button" disabled={llm.status !== 'online' || busy || cases.length <= trigger} onClick={() => void generate()}>{busy && <span className="spinner" />}{busy ? t('questions.generating') : t('questions.generate')}</button>
        <button className="icon-button" type="button" title={t('questions.newManual')} aria-label={t('questions.newManual')} onClick={() => setManualOpen((value) => !value)}><span aria-hidden="true">＋</span></button>
      </div>
      {remaining > 0 && <div className="threshold-meter"><div style={{ width: `${Math.min(100, (cases.length / (trigger + 1)) * 100)}%` }} /><span>{t('questions.belowTrigger', { count: remaining })}</span></div>}
      {manualOpen && (
        <form className="manual-question-card" onSubmit={(event) => { event.preventDefault(); void createManual(); }}>
          <label><span>{t('questions.title')}</span><textarea rows={3} value={manualQuestion} onChange={(event) => setManualQuestion(event.target.value)} placeholder={t('questions.questionPlaceholder')} /></label>
          <label><span>{t('questions.reason')}</span><textarea rows={2} value={manualReason} onChange={(event) => setManualReason(event.target.value)} /></label>
          <div className="split-actions"><button className="quiet-button" type="button" onClick={() => setManualOpen(false)}>{t('app.cancel')}</button><button className="primary-button" type="submit" disabled={!manualQuestion.trim()}>{t('questions.saveQuestion')}</button></div>
        </form>
      )}
      <div className="filter-tabs" role="tablist">
        {(['', 'Föreslagen', 'Aktiv', 'Besvarad'] as const).map((status) => (
          <button key={status || 'all'} role="tab" type="button" className={statusFilter === status ? 'is-active' : ''} onClick={() => setStatusFilter(status)}>{status ? t(`questionStatus.${status}`) : t('questions.all')}<span>{questions.filter((item) => !status || item.status === status).length}</span></button>
        ))}
      </div>
      {visible.length === 0 ? (
        <div className="empty-state compact-empty"><span className="empty-glyph" aria-hidden="true">◎</span><strong>{t('questions.emptyTitle')}</strong><p>{t('questions.emptyBody')}</p></div>
      ) : (
        <div className="question-list">
          {visible.map((item) => (
            <article className={`question-card priority-${item.prioritet.toLocaleLowerCase()}`} key={item.id}>
              <header><span className="priority-chip">{t(`priority.${item.prioritet}`)}</span><span className={`question-status status-${item.status.toLocaleLowerCase()}`}>{t(`questionStatus.${item.status}`)}</span><span className="ai-authored">{item.created_by}</span></header>
              {String(editingId) === String(item.id) ? <div className="question-edit-fields"><label><span>{t('questions.title')}</span><textarea rows={3} value={editQuestion} onChange={(event) => setEditQuestion(event.target.value)} /></label><label><span>{t('questions.reason')}</span><textarea rows={2} value={editReason} onChange={(event) => setEditReason(event.target.value)} /></label></div> : <><h3>{item.question}</h3><div className="question-reason"><span className="eyebrow">{t('questions.reason')}</span><p>{item.motivering}</p></div></>}
              {item.forslag_inhamtning && <div className="collection-suggestion"><span className="eyebrow">{t('questions.collectionSuggestion')}</span><p>{item.forslag_inhamtning}</p></div>}
              {item.linked_case_ids.length > 0 && (
                <div className="linked-cases"><span>{t('questions.linkedCases')}</span>{item.linked_case_ids.map((id) => {
                  const linked = cases.find((candidate) => String(candidate.id) === String(id));
                  return <button type="button" key={id} disabled={!linked} onClick={() => linked && onOpenCase(linked)}>#{linked?.lopnr ?? id}</button>;
                })}</div>
              )}
              <footer>
                {String(editingId) === String(item.id) ? <><button className="primary-button compact-button" type="button" disabled={!editQuestion.trim()} onClick={() => { void update(item, { question: editQuestion.trim(), motivering: editReason.trim() }); setEditingId(null); }}>{t('app.save')}</button><button className="quiet-button compact-button" type="button" onClick={() => setEditingId(null)}>{t('app.cancel')}</button></> : <>{item.status === 'Föreslagen' && <><button className="primary-button compact-button" type="button" onClick={() => void update(item, { status: 'Aktiv' })}>{t('questions.accept')}</button><button className="quiet-button compact-button" type="button" onClick={() => void update(item, { status: 'Avförd' })}>{t('questions.dismiss')}</button></>}{item.status === 'Aktiv' && <button className="quiet-button compact-button" type="button" onClick={() => void update(item, { status: 'Besvarad' })}>{t('questions.markAnswered')}</button>}<button className="text-button" type="button" aria-label={t('questions.edit')} onClick={() => { setEditingId(item.id); setEditQuestion(item.question); setEditReason(item.motivering); }}>{t('app.edit')}</button></>}
              </footer>
              <details className="question-notes"><summary>{t('notes.title')}</summary><EntityNotes compact entityType="spaningsfraga" entityId={item.id} initialNotes={item.notes} onNotify={onNotify} onError={onError} /></details>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
