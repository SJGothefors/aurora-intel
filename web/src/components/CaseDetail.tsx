import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Assessment, IntelCase, LlmStatus, Note, VocabularyTerm } from '../types';
import { formatCoordinate, formatDateTime, normalizeTags } from '../utils';
import { CaseForm } from './CaseForm';
import { ConfirmDialog } from './Modal';
import { EntityNotes } from './EntityNotes';

interface CaseDetailProps {
  item: IntelCase | null;
  vocabulary: VocabularyTerm[];
  tagSuggestions: string[];
  llm: LlmStatus;
  cited: boolean;
  onClose: () => void;
  onUpdate: (item: IntelCase, patch: Partial<IntelCase>) => Promise<void>;
  onDelete: (item: IntelCase) => Promise<void>;
  onNotesChange: (item: IntelCase, notes: Note[]) => void;
  onNotify: (message: string) => void;
  onError: (message: string) => void;
  onAssess: (item: IntelCase) => Promise<Assessment>;
  onAddPosition: (item: IntelCase) => void;
}

type Tab = 'overview' | 'report' | 'assessment' | 'notes';

export function CaseDetail({ item, vocabulary, tagSuggestions, llm, cited, onClose, onUpdate, onDelete, onNotesChange, onNotify, onError, onAssess, onAddPosition }: CaseDetailProps) {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<IntelCase>>({});
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [assessing, setAssessing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!item) return;
    setTab('overview');
    setEditing(false);
    setDraft(item);
    setAssessment(null);
  }, [item?.id]);

  const notes = useMemo(() => [...(item?.notes ?? [])].sort((a, b) => b.ts.localeCompare(a.ts)), [item?.notes]);
  if (!item) return null;

  const saveEdit = async () => {
    setSaving(true);
    try { await onUpdate(item, draft); setEditing(false); } finally { setSaving(false); }
  };
  const runAssessment = async () => {
    setAssessing(true);
    try { setAssessment(await onAssess(item)); } finally { setAssessing(false); }
  };
  const saveAssessment = async () => {
    if (!assessment) return;
    const text = `${t('detail.fact')}: ${assessment.fakta}\n\n${t('detail.judgement')} (${assessment.sannolikhet}): ${assessment.bedomning}\n\n${t('detail.reasoning')}: ${assessment.motivering}\n\n${t('detail.recommendation')}: ${assessment.rekommendation}`;
    await onUpdate(item, { bedomning: text });
    setAssessment(null);
  };

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="detail-drawer" aria-label={t('detail.title', { number: item.lopnr })}>
        <header className="detail-header">
          <div><span className="eyebrow">{t('detail.eyebrow')}</span><h2>{t('detail.title', { number: item.lopnr })}</h2><div className="detail-chips"><span className={`status-chip status-${item.status.replace(/\s/g, '-').toLowerCase()}`}>{t(`status.${item.status}`)}</span>{item.star && <span className="star-chip">★</span>}{cited && <span className="citation-chip">↳ {t('detail.flash')}</span>}</div></div>
          <button className="icon-button" type="button" aria-label={t('app.close')} title={t('app.close')} onClick={onClose}>×</button>
        </header>
        <nav className="drawer-tabs">
          {(['overview', 'report', 'assessment', 'notes'] as const).map((value) => <button key={value} type="button" className={tab === value ? 'is-active' : ''} onClick={() => setTab(value)}>{t(`detail.${value}`)}{value === 'notes' && notes.length > 0 ? <span>{notes.length}</span> : null}</button>)}
        </nav>
        <div className="detail-content">
          {tab === 'overview' && (editing ? (
            <CaseForm value={draft} vocabulary={vocabulary} tagSuggestions={tagSuggestions} submitLabel={t('app.save')} busy={saving} onChange={setDraft} onSubmit={() => void saveEdit()} />
          ) : (
            <div className="detail-overview">
              <div className="detail-actions"><button className="quiet-button" type="button" onClick={() => setEditing(true)}>{t('app.edit')}</button>{item.position_missing && <button className="accent-button" type="button" onClick={() => onAddPosition(item)}><span aria-hidden="true">⚑</span>{t('ledger.addPosition')}</button>}</div>
              <section className="detail-section"><span className="eyebrow">7S</span><dl className="field-list">
                <div><dt>{t('form.time')}</dt><dd><strong>{item.dtg_raw ?? '—'}</strong><small>{formatDateTime(item.time_utc, i18n.language)}{item.time_uncertain ? ` · ${t('intake.uncertain')}` : ''}</small></dd></div>
                <div><dt>{t('form.place')}</dt><dd><strong>{item.place_name ?? item.place_raw ?? '—'}</strong><small className="mono-cell">{item.mgrs ?? `${formatCoordinate(item.lat)}, ${formatCoordinate(item.lon)}`}</small></dd></div>
                <div><dt>{t('form.strength')}</dt><dd>{item.styrka_raw ?? '—'}</dd></div>
                <div><dt>{t('form.type')}</dt><dd>{item.slag ?? '—'}</dd></div>
                <div className="full-field"><dt>{t('form.activity')}</dt><dd>{item.sysselsattning ?? '—'}</dd></div>
                <div><dt>{t('form.symbol')}</dt><dd>{item.symbol ?? '—'}</dd></div>
                <div><dt>{t('form.source')}</dt><dd>{item.sagesman ?? '—'}</dd></div>
              </dl></section>
              <section className="detail-section"><span className="eyebrow">{t('form.vocabulary')}</span><div className="chip-row detail-term-row">{item.begrepp.length ? item.begrepp.map((term) => <span className="term-chip" key={term}>{term}</span>) : '—'}</div><dl className="field-list compact-fields"><div><dt>{t('form.actor')}</dt><dd>{t(`actor.${item.aktor}`)}</dd></div><div><dt>{t('form.status')}</dt><dd>{t(`status.${item.status}`)}</dd></div></dl><label className="inline-tags"><span>{t('form.tags')}</span><input list="case-detail-tag-suggestions" defaultValue={item.tags.join(', ')} onBlur={(event) => { const tags = normalizeTags(event.target.value); if (tags.join('|') !== item.tags.join('|')) void onUpdate(item, { tags }); }} placeholder={t('form.tagsPlaceholder')} /><datalist id="case-detail-tag-suggestions">{tagSuggestions.map((tag) => <option key={tag} value={tag} />)}</datalist></label></section>
              <section className="detail-section metadata-section"><span className="eyebrow">{t('detail.metadata')}</span><dl className="field-list compact-fields"><div><dt>{t('detail.created')}</dt><dd>{formatDateTime(item.created_at, i18n.language)}</dd></div><div><dt>{t('detail.updated')}</dt><dd>{formatDateTime(item.updated_at, i18n.language)}</dd></div><div><dt>{t('detail.operator')}</dt><dd>{item.created_by || '—'}</dd></div></dl></section>
              <button className="danger-link" type="button" onClick={() => setDeleteOpen(true)}>{t('detail.deleteCase')}</button>
            </div>
          ))}

          {tab === 'report' && <div className="report-view"><span className="eyebrow">{t('detail.report')}</span><pre>{item.kallrapport_raw ?? t('app.empty')}</pre>{item.ai_json != null && <details><summary>{t('detail.aiOutput')}</summary><pre className="json-view">{JSON.stringify(item.ai_json, null, 2)}</pre></details>}</div>}

          {tab === 'assessment' && <div className="assessment-view">
            <div className="assessment-heading"><div><span className="eyebrow">{t('detail.assessment')}</span><p>{llm.status === 'online' ? t('ask.intro') : t('llm.unavailableHint')}</p></div><button className="primary-button" type="button" disabled={llm.status !== 'online' || assessing} onClick={() => void runAssessment()}>{assessing && <span className="spinner" />}{assessing ? t('detail.assessing') : t('detail.assess')}</button></div>
            {assessing && <div className="analysis-progress"><div className="radar-glyph" aria-hidden="true"><i /></div><strong>{t('detail.assessing')}</strong></div>}
            {assessment && <div className="assessment-result"><section><span className="eyebrow">{t('detail.fact')}</span><p>{assessment.fakta}</p></section><section className="judgement-section"><span className="eyebrow">{t('detail.judgement')} · {assessment.sannolikhet.toLocaleUpperCase()}</span><p>{assessment.bedomning}</p></section><dl><div><dt>{t('detail.reasoning')}</dt><dd>{assessment.motivering}</dd></div><div><dt>{t('detail.recommendation')}</dt><dd>{assessment.rekommendation}</dd></div></dl><button className="primary-button" type="button" onClick={() => void saveAssessment()}>{t('detail.saveAssessment')}</button></div>}
            {!assessment && !assessing && item.bedomning && <div className="stored-assessment"><span className="eyebrow">{t('detail.assessment')}</span><p>{item.bedomning}</p></div>}
            {!assessment && !assessing && !item.bedomning && <div className="empty-state compact-empty"><span className="empty-glyph" aria-hidden="true">△</span><strong>{t('detail.assessment')}</strong><p>{t('ask.emptyBody')}</p></div>}
          </div>}

          {tab === 'notes' && <div className="notes-view"><EntityNotes entityType="case" entityId={item.id} initialNotes={notes} onChange={(next) => onNotesChange(item, next)} onNotify={onNotify} onError={onError} /></div>}
        </div>
      </aside>
      <ConfirmDialog open={deleteOpen} title={t('detail.deleteConfirm')} body={t('detail.deleteBody')} confirmLabel={t('detail.deleteCase')} destructive onClose={() => setDeleteOpen(false)} onConfirm={() => { setDeleteOpen(false); void onDelete(item); }} />
    </>
  );
}
