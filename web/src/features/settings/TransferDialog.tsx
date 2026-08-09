import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ImportApplyResult, ImportIssue, ImportPreview } from '../../types';
import { Modal } from '../../components/common/Modal';

interface TransferDialogProps {
  open: boolean;
  filteredCount: number;
  totalCount: number;
  onClose: () => void;
  onExport: (format: 'xlsx' | 'csv', scope: 'all' | 'filtered', separator: ';' | ',') => void;
  onPreview: (file: File, mapping?: Record<string, string>) => Promise<ImportPreview>;
  onApply: (token: string, mode: ImportMode, mapping: Record<string, string>) => Promise<ImportApplyResult>;
}

type ImportMode = 'replace' | 'merge' | 'append';

const EXPORT_COLUMNS = [
  'id', 'lopnr', 'created_at', 'updated_at', 'created_by', 'status', 'star',
  'tags', 'begrepp', 'aktor', 'source_report_id', 'dtg_raw', 'time_utc', 'time_uncertain',
  'place_raw', 'place_name', 'mgrs', 'lat', 'lon', 'position_missing',
  'styrka_raw', 'count_min', 'count_max', 'slag', 'sysselsattning',
  'symbol', 'sagesman', 'kallrapport_raw', 'ai_json', 'bedomning',
  'fields_uncertain', 'notes_json',
] as const;

const MEANINGFUL_IMPORT_FIELDS = [
  'tags', 'begrepp', 'aktor', 'source_report_id', 'dtg_raw', 'time_utc', 'place_raw',
  'place_name', 'mgrs', 'lat', 'lon', 'styrka_raw', 'count_min',
  'count_max', 'slag', 'sysselsattning', 'symbol', 'sagesman',
  'kallrapport_raw', 'bedomning',
] as const;

function hasMeaningfulMapping(mapping: Record<string, string>, headers: string[]): boolean {
  return MEANINGFUL_IMPORT_FIELDS.some((target) => {
    const source = mapping[target];
    return Boolean(source && headers.includes(source));
  });
}

function issueText(issue: ImportIssue): string {
  return issue.message ?? issue.code ?? JSON.stringify(issue);
}

export function TransferDialog({ open, filteredCount, totalCount, onClose, onExport, onPreview, onApply }: TransferDialogProps) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [scope, setScope] = useState<'all' | 'filtered'>('all');
  const [separator, setSeparator] = useState<';' | ','>(';');
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mappingDirty, setMappingDirty] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const [result, setResult] = useState<ImportApplyResult | null>(null);
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (open) return;
    setFile(null);
    setPreview(null);
    setMapping({});
    setMappingDirty(false);
    setResult(null);
    setLocalError('');
    setBusy(null);
  }, [open]);

  const exactAuroraExport = useMemo(
    () => Boolean(preview && EXPORT_COLUMNS.every((column) => preview.headers.includes(column))),
    [preview],
  );
  const meaningfulMapping = useMemo(
    () => Boolean(preview && hasMeaningfulMapping(mapping, preview.headers)),
    [mapping, preview],
  );
  const previewReady = Boolean(preview?.can_apply && !mappingDirty && meaningfulMapping);

  const runPreview = async (selectedFile: File, requestedMapping?: Record<string, string>) => {
    setBusy('preview');
    setLocalError('');
    setResult(null);
    try {
      const next = await onPreview(selectedFile, requestedMapping);
      setPreview(next);
      if (requestedMapping) {
        setMapping(requestedMapping);
        setMappingDirty(false);
      } else {
        const autoMapping = Object.fromEntries(EXPORT_COLUMNS.map((target) => {
          const suggested = next.auto_mapping?.[target];
          const source = suggested && next.headers.includes(suggested)
            ? suggested
            : next.headers.includes(target) ? target : '';
          return [target, source];
        }));
        setMapping(autoMapping);
        const exact = EXPORT_COLUMNS.every((column) => next.headers.includes(column));
        setMode(exact ? 'replace' : 'merge');
        // A complete Aurora export is already previewed against its identity
        // mapping. Other layouts must be explicitly mapped and revalidated.
        setMappingDirty(!exact);
      }
    } catch (error) {
      setPreview(null);
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const chooseFile = (selected: File | null) => {
    setFile(selected);
    setPreview(null);
    setResult(null);
    setMapping({});
    setMappingDirty(false);
    if (selected) void runPreview(selected);
  };

  const apply = async () => {
    if (!preview || mappingDirty || !preview.can_apply || !meaningfulMapping) return;
    setBusy('apply');
    setLocalError('');
    try {
      setResult(await onApply(preview.token, mode, mapping));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open={open} wide eyebrow={t('transfer.eyebrow')} title={t('transfer.title')} onClose={onClose}>
      <div className="transfer-grid">
        <section className="transfer-card export-card">
          <header><span className="transfer-index">↓</span><div><h3>{t('transfer.export')}</h3><p>{t('transfer.exportBody')}</p></div></header>
          <label><span>{t('transfer.scope')}</span><div className="segmented-control"><button type="button" className={scope === 'all' ? 'is-active' : ''} onClick={() => setScope('all')}>{t('transfer.all')} <small>{totalCount}</small></button><button type="button" className={scope === 'filtered' ? 'is-active' : ''} onClick={() => setScope('filtered')}>{t('transfer.filtered')} <small>{filteredCount}</small></button></div></label>
          <label><span>{t('transfer.format')}</span><div className="segmented-control"><button type="button" className={format === 'xlsx' ? 'is-active' : ''} onClick={() => setFormat('xlsx')}>.XLSX</button><button type="button" className={format === 'csv' ? 'is-active' : ''} onClick={() => setFormat('csv')}>.CSV</button></div></label>
          {format === 'csv' && <label><span>{t('transfer.separator')}</span><select value={separator} onChange={(event) => setSeparator(event.target.value as ';' | ',')}><option value=";">{t('transfer.semicolon')}</option><option value=",">{t('transfer.comma')}</option></select></label>}
          <button className="primary-button" type="button" onClick={() => onExport(format, scope, separator)}>{t('transfer.download')}</button>
        </section>

        <section className="transfer-card import-card">
          <header><span className="transfer-index">↑</span><div><h3>{t('transfer.import')}</h3><p>{t('transfer.importBody')}</p></div></header>
          <label className={`drop-zone${file ? ' has-file' : ''}`}>
            <input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} />
            <span className="empty-glyph" aria-hidden="true">＋</span>
            <strong>{file?.name ?? t('transfer.chooseFile')}</strong>
            <small>{file ? `${Math.ceil(file.size / 1024)} KB · ${t('transfer.changeFile')}` : '.xlsx / .csv'}</small>
          </label>

          {busy === 'preview' && <div className="import-preview-loading" role="status"><span className="spinner" />{t('transfer.previewing')}</div>}
          {localError && <div className="import-issue-list is-error"><strong>{t('transfer.errors')}</strong><p>{localError}</p></div>}

          {preview && busy !== 'preview' && (
            <>
              <div className={`import-preview-status${previewReady ? ' is-valid' : ' is-invalid'}`}>
                <span aria-hidden="true">{previewReady ? '✓' : '!'}</span>
                <div><strong>{t(previewReady ? 'transfer.previewReady' : 'transfer.previewNeedsAttention')}</strong><small>{t('transfer.previewCounts', preview.counts)}</small></div>
              </div>

              <label><span>{t('transfer.mode')}</span><select value={mode} onChange={(event) => setMode(event.target.value as ImportMode)}><option value="replace">{t('transfer.replace')}</option><option value="merge">{t('transfer.merge')}</option><option value="append">{t('transfer.append')}</option></select><small>{t(`transfer.${mode}Hint`)}</small></label>
              {mode === 'replace' && <p className="replace-import-notice"><span aria-hidden="true">△</span>{t(exactAuroraExport ? 'transfer.exactRestoreHint' : 'transfer.replaceWarning')}</p>}

              {preview.duplicates.length > 0 && <div className="import-issue-list is-warning"><strong>{t('transfer.duplicates', { count: preview.duplicates.length })}</strong><ul>{preview.duplicates.slice(0, 6).map((duplicate) => <li key={duplicate.row}>{t('transfer.duplicateRow', { row: duplicate.row, count: duplicate.matches.length })}</li>)}</ul></div>}
              {(preview.warnings?.length ?? 0) > 0 && <div className="import-issue-list is-warning"><strong>{t('transfer.warnings')}</strong><ul>{preview.warnings?.map((warning, index) => <li key={`${warning.code ?? 'warning'}-${index}`}>{warning.row ? `${t('transfer.row', { row: warning.row })}: ` : ''}{issueText(warning)}</li>)}</ul></div>}
              {preview.errors.length > 0 && <div className="import-issue-list is-error"><strong>{t('transfer.errors')}</strong><ul>{preview.errors.map((error, index) => <li key={`${error.code ?? 'error'}-${index}`}>{error.row ? `${t('transfer.row', { row: error.row })}: ` : ''}{issueText(error)}</li>)}</ul></div>}

              <details className="mapping-details" open={!preview.can_apply || mappingDirty || !meaningfulMapping}>
                <summary>{t('transfer.mapping')} <small>{t('transfer.actualHeaders', { count: preview.headers.length })}</small></summary>
                <div className="mapping-table-head"><span>{t('transfer.targetField')}</span><span /><span>{t('transfer.sourceHeader')}</span></div>
                <div className="mapping-table-body">{EXPORT_COLUMNS.map((target) => <label key={target}><code>{target}</code><span>←</span><select value={mapping[target] ?? ''} onChange={(event) => { setMapping((current) => ({ ...current, [target]: event.target.value })); setMappingDirty(true); }}><option value="">{t('transfer.notMapped')}</option>{preview.headers.map((header) => <option value={header} key={header}>{header}</option>)}</select></label>)}</div>
              </details>

              {!meaningfulMapping && <p className="mapping-required"><span aria-hidden="true">!</span>{t('transfer.mappingRequired')}</p>}
              {mappingDirty && <button className="quiet-button" type="button" disabled={!file || busy !== null || !meaningfulMapping} onClick={() => file && void runPreview(file, mapping)}>{t('transfer.validateMapping')}</button>}
              <p className="duplicate-hint"><span aria-hidden="true">△</span>{t('transfer.duplicateWarning')}</p>
              <button className="primary-button apply-import-button" type="button" disabled={busy !== null || mappingDirty || !preview.can_apply || !meaningfulMapping || Boolean(result)} onClick={() => void apply()}>{busy === 'apply' && <span className="spinner" />}{t('transfer.applyImport')}</button>
            </>
          )}

          {result && <div className="import-result"><strong>{t('transfer.imported', { count: result.inserted + result.updated })}</strong><span>{t('transfer.importResult', { inserted: result.inserted, updated: result.updated, skipped: result.skipped })}</span></div>}
        </section>
      </div>
    </Modal>
  );
}
