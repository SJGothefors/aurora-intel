import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, describeError } from '../api';
import type { Note } from '../types';
import { formatDateTime } from '../utils';

interface EntityNotesProps {
  entityType: Note['entity_type'];
  entityId: string | number;
  initialNotes?: Note[];
  compact?: boolean;
  onChange?: (notes: Note[]) => void;
  onNotify?: (message: string) => void;
  onError?: (message: string) => void;
}

export function EntityNotes({ entityType, entityId, initialNotes = [], compact, onChange, onNotify, onError }: EntityNotesProps) {
  const { t, i18n } = useTranslation();
  const [notes, setNotes] = useState<Note[]>(initialNotes);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<Note['id'] | null>(null);
  const [editingText, setEditingText] = useState('');
  const [busy, setBusy] = useState(false);

  const publish = (next: Note[]) => {
    const ordered = [...next].sort((a, b) => b.ts.localeCompare(a.ts));
    setNotes(ordered);
    onChange?.(ordered);
  };

  useEffect(() => {
    let cancelled = false;
    setNotes(initialNotes);
    void api.getNotes(entityType, entityId).then((rows) => { if (!cancelled) publish(rows); }).catch((error) => { if (!cancelled) onError?.(describeError(error)); });
    return () => { cancelled = true; };
    // Initial notes are deliberately not a dependency: parent updates are published by this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, entityType]);

  const add = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      const saved = await api.addNote(entityType, entityId, draft.trim());
      publish([saved, ...notes]);
      setDraft('');
      onNotify?.(t('toast.noteSaved'));
    } catch (error) { onError?.(describeError(error)); } finally { setBusy(false); }
  };

  const update = async (note: Note) => {
    if (!editingText.trim() || busy) return;
    setBusy(true);
    try {
      const saved = await api.updateNote(note.id, editingText.trim());
      publish(notes.map((item) => String(item.id) === String(note.id) ? { ...item, ...saved } : item));
      setEditingId(null);
      setEditingText('');
      onNotify?.(t('toast.noteUpdated'));
    } catch (error) { onError?.(describeError(error)); } finally { setBusy(false); }
  };

  const remove = async (note: Note) => {
    if (!window.confirm(t('notes.deleteConfirm'))) return;
    setBusy(true);
    try {
      await api.deleteNote(note.id);
      publish(notes.filter((item) => String(item.id) !== String(note.id)));
      onNotify?.(t('toast.noteDeleted'));
    } catch (error) { onError?.(describeError(error)); } finally { setBusy(false); }
  };

  return (
    <div className={`entity-notes${compact ? ' compact-notes' : ''}`}>
      <form onSubmit={(event) => { event.preventDefault(); void add(); }}>
        <label><span>{t('notes.title')}</span><textarea rows={compact ? 2 : 4} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t('notes.placeholder')} /></label>
        <button className="primary-button compact-button" type="submit" disabled={!draft.trim() || busy}>{t('notes.add')}</button>
      </form>
      <div className="note-thread">
        {notes.length ? notes.map((note) => (
          <article key={note.id}>
            <header><strong>{t('notes.authorUnknown')}</strong><time>{formatDateTime(note.ts, i18n.language)}</time></header>
            {String(editingId) === String(note.id) ? (
              <div className="note-edit"><textarea rows={3} value={editingText} onChange={(event) => setEditingText(event.target.value)} /><div><button className="quiet-button compact-button" type="button" onClick={() => setEditingId(null)}>{t('app.cancel')}</button><button className="primary-button compact-button" type="button" disabled={!editingText.trim() || busy} onClick={() => void update(note)}>{t('notes.save')}</button></div></div>
            ) : <p>{note.text}</p>}
            {String(editingId) !== String(note.id) && <footer><button className="text-button" type="button" aria-label={t('notes.edit')} onClick={() => { setEditingId(note.id); setEditingText(note.text); }}>{t('app.edit')}</button><button className="text-button danger-text" type="button" aria-label={t('notes.delete')} onClick={() => void remove(note)}>{t('app.delete')}</button></footer>}
          </article>
        )) : <p className="empty-note">{t('notes.empty')}</p>}
      </div>
    </div>
  );
}
