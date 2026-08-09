import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VocabularyTerm } from '../../types';
import { Modal } from '../../components/common/Modal';
import { EntityNotes } from '../../components/common/EntityNotes';

interface VocabularyDialogProps {
  open: boolean;
  terms: VocabularyTerm[];
  onClose: () => void;
  onCreate: (term: Partial<VocabularyTerm>) => Promise<void>;
  onUpdate: (term: VocabularyTerm, patch: Partial<VocabularyTerm>) => Promise<void>;
  onDelete: (term: VocabularyTerm) => Promise<void>;
  onImport: (file: File) => Promise<void>;
  exportUrl: string;
  onNotify: (message: string) => void;
  onError: (message: string) => void;
}

const NEW_TERM: Partial<VocabularyTerm> = { name_sv: '', name_en: '', definition: '', active: true, sidc: '', sort: 999 };

function SymbolPreview(_props: { sidc: string }) { return <i className="term-color-box" aria-hidden="true" />; }

export function VocabularyDialog({ open, terms, onClose, onCreate, onUpdate, onDelete, onImport, exportUrl, onNotify, onError }: VocabularyDialogProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<VocabularyTerm | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Partial<VocabularyTerm>>(NEW_TERM);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!open) { setEditing(null); setCreating(false); setDraft(NEW_TERM); } }, [open]);
  const visible = useMemo(() => terms.filter((term) => `${term.name_sv} ${term.name_en} ${term.definition}`.toLocaleLowerCase('sv').includes(search.toLocaleLowerCase('sv'))).sort((a, b) => a.sort - b.sort), [search, terms]);
  const startEdit = (term: VocabularyTerm) => { setEditing(term); setCreating(false); setDraft(term); };
  const startCreate = () => { setEditing(null); setCreating(true); setDraft({ ...NEW_TERM, sort: terms.length + 1 }); };
  const save = async () => { setBusy(true); try { if (editing) await onUpdate(editing, draft); else await onCreate(draft); setEditing(null); setCreating(false); setDraft(NEW_TERM); } finally { setBusy(false); } };
  const move = async (term: VocabularyTerm, direction: -1 | 1) => { const ordered = [...terms].sort((a, b) => a.sort - b.sort); const index = ordered.findIndex((item) => item.id === term.id); const other = ordered[index + direction]; if (!other) return; await Promise.all([onUpdate(term, { sort: other.sort }), onUpdate(other, { sort: term.sort })]); };
  return (
    <Modal open={open} wide eyebrow={t('vocabulary.eyebrow')} title={t('vocabulary.title')} onClose={onClose}>
      <div className="vocabulary-layout">
        <div className="vocabulary-main">
          <div className="vocabulary-intro"><p>{t('vocabulary.body')}</p><div className="vocabulary-tools"><label className="search-field small-search"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('vocabulary.search')} /></label><button className="primary-button" type="button" onClick={startCreate}>＋ {t('vocabulary.new')}</button></div></div>
          <div className="vocabulary-table" role="table">
            <div className="vocabulary-head" role="row"><span>{t('vocabulary.symbol')}</span><span>{t('vocabulary.nameSv')}</span><span>{t('vocabulary.definition')}</span><span>{t('vocabulary.active')}</span><span /></div>
            {visible.length ? visible.map((term) => <div className={`vocabulary-row${editing?.id === term.id ? ' is-selected' : ''}`} role="row" key={term.id} onClick={() => startEdit(term)}><span><SymbolPreview sidc={term.sidc} /></span><span><strong>{term.name_sv}</strong><small>{term.name_en}</small></span><span className="truncate-2">{term.definition}</span><span><i className={`active-dot${term.active ? ' is-active' : ''}`} />{term.active ? t('vocabulary.active') : t('vocabulary.inactive')}</span><span className="row-order-actions"><button className="icon-button small-icon-button" type="button" title={t('vocabulary.moveUp')} onClick={(event) => { event.stopPropagation(); void move(term, -1); }}>↑</button><button className="icon-button small-icon-button" type="button" title={t('vocabulary.moveDown')} onClick={(event) => { event.stopPropagation(); void move(term, 1); }}>↓</button></span></div>) : <div className="vocabulary-empty">{t('vocabulary.empty')}</div>}
          </div>
          <div className="vocabulary-transfer"><a className="quiet-button button-link" href={exportUrl} download>{t('vocabulary.export')}</a><label className="quiet-button file-button">{t('vocabulary.import')}<input type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onImport(file); }} /></label></div>
        </div>
        {(editing || creating) ? <aside className="term-editor"><header><span className="eyebrow">{editing ? t('app.edit') : t('vocabulary.new')}</span><button className="icon-button small-icon-button" type="button" onClick={() => { setEditing(null); setCreating(false); }}>×</button></header><div className="term-symbol-large"><SymbolPreview sidc={draft.sidc ?? ''} /></div><label><span>{t('vocabulary.nameSv')}</span><input value={draft.name_sv ?? ''} onChange={(event) => setDraft((current) => ({ ...current, name_sv: event.target.value.toUpperCase() }))} /></label><label><span>{t('vocabulary.nameEn')}</span><input value={draft.name_en ?? ''} onChange={(event) => setDraft((current) => ({ ...current, name_en: event.target.value }))} /></label><label><span>{t('vocabulary.definition')}</span><textarea rows={5} value={draft.definition ?? ''} onChange={(event) => setDraft((current) => ({ ...current, definition: event.target.value }))} /></label><label><span>{t('vocabulary.sidc')}</span><input className="mono-input" value={draft.sidc ?? ''} onChange={(event) => setDraft((current) => ({ ...current, sidc: event.target.value.toUpperCase() }))} /></label><label className="switch-row"><span>{draft.active ? t('vocabulary.active') : t('vocabulary.inactive')}</span><input type="checkbox" checked={draft.active ?? true} disabled={editing?.name_sv === 'ÖVRIGT/OKÄNT'} onChange={(event) => setDraft((current) => ({ ...current, active: event.target.checked }))} /></label>{editing?.name_sv === 'ÖVRIGT/OKÄNT' && <small>{t('vocabulary.protected')}</small>}<button className="primary-button" type="button" disabled={busy || !draft.name_sv?.trim()} onClick={() => void save()}>{busy && <span className="spinner" />}{t('vocabulary.save')}</button>{editing && editing.name_sv !== 'ÖVRIGT/OKÄNT' && <button className="danger-link" type="button" onClick={() => void onDelete(editing)}>{t('app.delete')}</button>}{editing && <details className="term-notes"><summary>{t('notes.title')}</summary><EntityNotes compact entityType="begrepp" entityId={editing.id} initialNotes={editing.notes} onNotify={onNotify} onError={onError} /></details>}</aside> : <aside className="term-editor term-editor-empty"><span className="empty-glyph" aria-hidden="true">◇</span><p>{t('vocabulary.body')}</p></aside>}
      </div>
    </Modal>
  );
}
