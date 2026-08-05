import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Actor, CaseStatus, IntelCase, VocabularyTerm } from '../types';
import { fromMgrs, normalizeTags, toMgrs } from '../utils';

const STATUSES: CaseStatus[] = ['Ny', 'Under bearbetning', 'Uppföljning', 'Avslutad'];
const ACTORS: Actor[] = ['Okänd', 'Misstänkt främmande', 'Civil', 'Egen'];
const EXTRACTION_UNCERTAINTY_FIELDS = [
  { field: 'stunden', label: 'form.time' },
  { field: 'stallet', label: 'form.place' },
  { field: 'styrkan', label: 'form.strength' },
  { field: 'slaget', label: 'form.type' },
  { field: 'sysselsattningen', label: 'form.activity' },
  { field: 'symbolen', label: 'form.symbol' },
  { field: 'sagesmannen', label: 'form.source' },
  { field: 'begrepp', label: 'form.vocabulary' },
] as const;

interface CaseFormProps {
  value: Partial<IntelCase>;
  vocabulary: VocabularyTerm[];
  submitLabel: string;
  busy?: boolean;
  showRaw?: boolean;
  tagSuggestions?: string[];
  onChange: (value: Partial<IntelCase>) => void;
  onSubmit: () => void;
}

function numberValue(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

function toNumber(value: string): number | null {
  const parsed = Number(value);
  return value.trim() && Number.isFinite(parsed) ? parsed : null;
}

export function CaseForm({ value, vocabulary, submitLabel, busy, showRaw = true, tagSuggestions = [], onChange, onSubmit }: CaseFormProps) {
  const { t } = useTranslation();
  const [positionError, setPositionError] = useState(false);
  const tagListId = useId();
  const uncertaintyHintId = useId();
  const activeTerms = useMemo(() => vocabulary.filter((term) => term.active), [vocabulary]);
  const patch = (input: Partial<IntelCase>) => onChange({ ...value, ...input });
  const uncertain = (field: string) => Boolean(value.fields_uncertain?.includes(field));
  const visuallyUncertain = (field: string) => uncertain(field) || (field === 'stunden' && Boolean(value.time_uncertain));

  const setUncertain = (field: string, checked: boolean) => {
    const fields = new Set(value.fields_uncertain ?? []);
    if (checked) fields.add(field);
    else fields.delete(field);
    patch({ fields_uncertain: [...fields] });
  };

  const normalizePosition = () => {
    if (value.mgrs?.trim()) {
      const converted = fromMgrs(value.mgrs);
      if (!converted) { setPositionError(true); return; }
      patch({ ...converted, position_missing: false });
      setPositionError(false);
      return;
    }
    if (typeof value.lat === 'number' && typeof value.lon === 'number') {
      const normalized = toMgrs(value.lat, value.lon);
      if (!normalized) { setPositionError(true); return; }
      patch({ mgrs: normalized, position_missing: false });
      setPositionError(false);
      return;
    }
    patch({ mgrs: null, lat: null, lon: null, position_missing: true });
    setPositionError(false);
  };

  return (
    <form className="case-form" onSubmit={(event) => { event.preventDefault(); normalizePosition(); onSubmit(); }}>
      <div className="form-section">
        <div className="form-section-heading"><span>1</span><strong>7S</strong></div>
        <label className="form-span-2">
          <span>{t('form.sourceReportId')}</span>
          <input className="mono-input" value={value.source_report_id ?? ''} onChange={(event) => patch({ source_report_id: event.target.value || null })} />
        </label>
        <label className={visuallyUncertain('stunden') ? 'field-uncertain' : ''}>
          <span>{t('form.time')}{visuallyUncertain('stunden') && <em>{t('intake.uncertain')}</em>}</span>
          <input value={value.dtg_raw ?? ''} onChange={(event) => patch({ dtg_raw: event.target.value || null })} placeholder="010632B AUG 26" />
        </label>
        <label>
          <span>{t('form.timeIso')}</span>
          <input className="mono-input" value={value.time_utc ?? ''} onChange={(event) => patch({ time_utc: event.target.value || null })} placeholder="2026-08-01T04:32:00Z" />
        </label>
        <label className={uncertain('stallet') ? 'field-uncertain form-span-2' : 'form-span-2'}>
          <span>{t('form.place')}{uncertain('stallet') && <em>{t('intake.uncertain')}</em>}</span>
          <input value={value.place_raw ?? ''} onChange={(event) => patch({ place_raw: event.target.value || null })} />
        </label>
        <label>
          <span>{t('form.placeName')}</span>
          <input value={value.place_name ?? ''} onChange={(event) => patch({ place_name: event.target.value || null })} />
        </label>
        <label>
          <span>{t('form.mgrs')}</span>
          <input className="mono-input" value={value.mgrs ?? ''} onChange={(event) => patch({ mgrs: event.target.value.toUpperCase() || null })} onBlur={normalizePosition} placeholder="33V WE 12345 67890" />
        </label>
        <label>
          <span>{t('form.latitude')}</span>
          <input className="mono-input" type="number" step="any" min="-90" max="90" value={numberValue(value.lat)} onChange={(event) => patch({ lat: toNumber(event.target.value) })} onBlur={normalizePosition} />
        </label>
        <label>
          <span>{t('form.longitude')}</span>
          <input className="mono-input" type="number" step="any" min="-180" max="180" value={numberValue(value.lon)} onChange={(event) => patch({ lon: toNumber(event.target.value) })} onBlur={normalizePosition} />
        </label>
        {positionError && <p className="field-error form-span-2">{t('form.invalidPosition')}</p>}
        <label className={uncertain('styrkan') ? 'field-uncertain' : ''}>
          <span>{t('form.strength')}{uncertain('styrkan') && <em>{t('intake.uncertain')}</em>}</span>
          <input value={value.styrka_raw ?? ''} onChange={(event) => patch({ styrka_raw: event.target.value || null })} />
        </label>
        <div className="field-pair">
          <label><span>{t('form.countMin')}</span><input type="number" min="0" value={numberValue(value.count_min)} onChange={(event) => patch({ count_min: toNumber(event.target.value) })} /></label>
          <label><span>{t('form.countMax')}</span><input type="number" min="0" value={numberValue(value.count_max)} onChange={(event) => patch({ count_max: toNumber(event.target.value) })} /></label>
        </div>
        <label className={uncertain('slaget') ? 'field-uncertain form-span-2' : 'form-span-2'}>
          <span>{t('form.type')}{uncertain('slaget') && <em>{t('intake.uncertain')}</em>}</span>
          <input value={value.slag ?? ''} onChange={(event) => patch({ slag: event.target.value || null })} />
        </label>
        <label className={uncertain('sysselsattningen') ? 'field-uncertain form-span-2' : 'form-span-2'}>
          <span>{t('form.activity')}{uncertain('sysselsattningen') && <em>{t('intake.uncertain')}</em>}</span>
          <textarea rows={3} value={value.sysselsattning ?? ''} onChange={(event) => patch({ sysselsattning: event.target.value || null })} />
        </label>
        <label className={uncertain('symbolen') ? 'field-uncertain' : ''}>
          <span>{t('form.symbol')}</span>
          <input value={value.symbol ?? ''} onChange={(event) => patch({ symbol: event.target.value || null })} />
        </label>
        <label className={uncertain('sagesmannen') ? 'field-uncertain' : ''}>
          <span>{t('form.source')}</span>
          <input value={value.sagesman ?? ''} onChange={(event) => patch({ sagesman: event.target.value || null })} />
        </label>
        <fieldset className="uncertainty-controls form-span-2" aria-describedby={uncertaintyHintId}>
          <legend>{t('form.uncertaintyTitle')}</legend>
          <p id={uncertaintyHintId}>{t('form.uncertaintyHint')}</p>
          <div>
            <label className={value.time_uncertain ? 'is-active' : ''}>
              <input
                type="checkbox"
                checked={Boolean(value.time_uncertain)}
                onChange={(event) => patch({ time_uncertain: event.target.checked })}
              />
              <span>{t('form.timeUncertain')}</span>
            </label>
            {EXTRACTION_UNCERTAINTY_FIELDS.map(({ field, label }) => (
              <label className={uncertain(field) ? 'is-active' : ''} key={field}>
                <input
                  type="checkbox"
                  checked={Boolean(uncertain(field))}
                  onChange={(event) => setUncertain(field, event.target.checked)}
                />
                <span>{t(label)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="form-section">
        <div className="form-section-heading"><span>2</span><strong>{t('form.vocabulary')}</strong></div>
        <label className={uncertain('begrepp') ? 'field-uncertain form-span-2' : 'form-span-2'}>
          <span>{t('form.vocabulary')}</span>
          <select
            multiple
            className="term-select"
            value={value.begrepp ?? []}
            onChange={(event) => patch({ begrepp: Array.from(event.target.selectedOptions, (option) => option.value) })}
          >
            {activeTerms.map((term) => <option key={term.id} value={term.name_sv}>{term.name_sv}</option>)}
          </select>
        </label>
        <label>
          <span>{t('form.actor')}</span>
          <select value={value.aktor ?? 'Okänd'} onChange={(event) => patch({ aktor: event.target.value as Actor })}>
            {ACTORS.map((actor) => <option key={actor} value={actor}>{t(`actor.${actor}`)}</option>)}
          </select>
        </label>
        <label>
          <span>{t('form.status')}</span>
          <select value={value.status ?? 'Ny'} onChange={(event) => patch({ status: event.target.value as CaseStatus })}>
            {STATUSES.map((status) => <option key={status} value={status}>{t(`status.${status}`)}</option>)}
          </select>
        </label>
        <label className="form-span-2">
          <span>{t('form.tags')}</span>
          <input list={tagListId} value={(value.tags ?? []).join(', ')} onChange={(event) => patch({ tags: normalizeTags(event.target.value) })} placeholder={t('form.tagsPlaceholder')} />
          <datalist id={tagListId}>{tagSuggestions.map((tag) => <option value={tag} key={tag} />)}</datalist>
        </label>
      </div>
      {showRaw && (
        <label className="raw-report-field">
          <span>{t('form.rawReport')}</span>
          <textarea rows={6} value={value.kallrapport_raw ?? ''} onChange={(event) => patch({ kallrapport_raw: event.target.value || null })} />
        </label>
      )}
      <div className="form-actions"><button className="primary-button" type="submit" disabled={busy}>{busy ? <span className="spinner" /> : null}{submitLabel}</button></div>
    </form>
  );
}
