import { useEffect, useRef, useState } from 'react';
import type { WeatherEntry } from '../../types';

interface Props {
  entries: WeatherEntry[];
  onAdd: (entry: Partial<WeatherEntry>) => Promise<void>;
  onDelete: (id: WeatherEntry['id']) => Promise<void>;
}

function localInputDate(hours = 1) {
  const date = new Date(Date.now() + hours * 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.valueOf() - offset).toISOString().slice(0, 16);
}

export function WeatherStrip({ entries, onAdd, onDelete }: Props) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ forecast_at: localInputDate(), temperature_c: '', rain_mm: '', humidity_pct: '', cloud_pct: '', note: '' });
  const hasWeatherValue = Boolean(draft.temperature_c || draft.rain_mm || draft.humidity_pct || draft.cloud_pct || draft.note.trim());
  const upcoming = entries.filter((entry) => new Date(entry.forecast_at).valueOf() >= Date.now() - 60 * 60_000).slice(0, 8);
  const save = async () => {
    setBusy(true);
    try {
      await onAdd({
        forecast_at: new Date(draft.forecast_at).toISOString(),
        temperature_c: draft.temperature_c === '' ? null : Number(draft.temperature_c),
        rain_mm: draft.rain_mm === '' ? null : Number(draft.rain_mm),
        humidity_pct: draft.humidity_pct === '' ? null : Number(draft.humidity_pct),
        cloud_pct: draft.cloud_pct === '' ? null : Number(draft.cloud_pct),
        note: draft.note || null,
      } as Partial<WeatherEntry>);
      setDraft((value) => ({ ...value, forecast_at: localInputDate(), note: '' }));
      setOpen(false);
    } finally { setBusy(false); }
  };
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!editorRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <section className="weather-strip" aria-label="Manual weather">
      <header><strong>WEATHER · MANUAL</strong><button ref={triggerRef} type="button" onClick={() => setOpen((value) => !value)}>{open ? 'Close' : '+ Add weather'}</button></header>
      <div className="weather-timeline">
        {!upcoming.length && <span className="weather-empty">No weather data entered</span>}
        {upcoming.map((entry) => {
          const temperature = entry.temperature_c;
          const tone = temperature == null ? '' : temperature <= 5 ? ' cold' : temperature >= 20 ? ' warm' : '';
          return <div className={`weather-point${tone}${(entry.rain_mm ?? 0) > 0 ? ' rain' : ''}`} key={entry.id}>
            <b>{new Date(entry.forecast_at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</b>
            <span>{temperature == null ? 'Temp —' : `${temperature} °C`}</span>
            <span>{entry.rain_mm == null ? 'Rain —' : `Rain ${entry.rain_mm} mm`}</span>
            <span>{entry.humidity_pct == null ? 'Humidity —' : `Humidity ${entry.humidity_pct}%`}</span>
            <span>{entry.cloud_pct == null ? 'Cloud —' : `Cloud ${entry.cloud_pct}%`}</span>
          </div>;
        })}
      </div>
      {open && <div className="weather-editor" ref={editorRef}>
        <header><div><strong>Add forecast observation</strong><p>Choose a date and time, then enter what is known. Unknown values stay empty.</p></div><span>1–3 observations per day · next 5 days</span></header>
        <label className="weather-time-field"><span>Date and time</span><input type="datetime-local" value={draft.forecast_at} onChange={(event) => setDraft({ ...draft, forecast_at: event.target.value })} /></label>
        <div className="weather-metrics">
          <label><span>Temperature</span><div><input type="number" min="-80" max="60" placeholder="e.g. 12" value={draft.temperature_c} onChange={(event) => setDraft({ ...draft, temperature_c: event.target.value })} /><b>°C</b></div></label>
          <label><span>Rain</span><div><input type="number" min="0" step="0.1" placeholder="e.g. 2" value={draft.rain_mm} onChange={(event) => setDraft({ ...draft, rain_mm: event.target.value })} /><b>mm</b></div></label>
          <label><span>Humidity</span><div><input type="number" min="0" max="100" placeholder="0–100" value={draft.humidity_pct} onChange={(event) => setDraft({ ...draft, humidity_pct: event.target.value })} /><b>%</b></div></label>
          <label><span>Cloud cover</span><div><input type="number" min="0" max="100" placeholder="0–100" value={draft.cloud_pct} onChange={(event) => setDraft({ ...draft, cloud_pct: event.target.value })} /><b>%</b></div></label>
        </div>
        <label className="weather-note-field"><span>Optional note</span><input placeholder="Source, wind, visibility or uncertainty" value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
        <footer><button className="quiet-button" type="button" onClick={() => setOpen(false)}>Cancel</button><button className="primary-button" type="button" disabled={busy || !draft.forecast_at || !hasWeatherValue} onClick={() => void save()}>{busy ? 'Saving…' : 'Save weather'}</button></footer>
        {entries.length > 0 && <details className="weather-existing"><summary>Manage {entries.length} saved observation{entries.length === 1 ? '' : 's'}</summary><div className="weather-delete-list">{entries.map((entry) => <button type="button" key={entry.id} onClick={() => void onDelete(entry.id)}>Remove {new Date(entry.forecast_at).toLocaleString()}</button>)}</div></details>}
      </div>}
    </section>
  );
}
