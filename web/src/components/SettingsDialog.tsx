import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LlmStatus, Settings } from '../types';
import { Modal } from './Modal';

interface SettingsDialogProps {
  open: boolean;
  settings: Settings;
  models: string[];
  llm: LlmStatus;
  onClose: () => void;
  onSave: (settings: Settings) => Promise<void>;
  onWipe: (phrase: string) => Promise<void>;
  onClearLogs: () => Promise<void>;
}

export function SettingsDialog({ open, settings, models, llm, onClose, onSave, onWipe, onClearLogs }: SettingsDialogProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [wipeStep, setWipeStep] = useState(0);
  const [wipePhrase, setWipePhrase] = useState('');
  useEffect(() => { if (open) { setDraft(settings); setWipeStep(0); setWipePhrase(''); } }, [open, settings]);
  const expectedPhrase = draft.lang === 'en' ? 'CLEAR' : 'RENSA';
  const save = async () => { setBusy(true); try { await onSave(draft); onClose(); } finally { setBusy(false); } };
  const wipe = async () => { if (wipePhrase !== expectedPhrase) return; setBusy(true); try { await onWipe(wipePhrase); setWipeStep(0); setWipePhrase(''); onClose(); } finally { setBusy(false); } };
  const patch = (value: Partial<Settings>) => setDraft((current) => ({ ...current, ...value }));
  return (
    <Modal open={open} wide eyebrow={t('settings.eyebrow')} title={t('settings.title')} onClose={onClose} footer={<><button className="quiet-button" type="button" onClick={onClose}>{t('app.cancel')}</button><button className="primary-button" type="button" disabled={busy} onClick={() => void save()}>{busy && <span className="spinner" />}{t('settings.save')}</button></>}>
      <div className="settings-grid">
        <section className="settings-section"><header><span className="section-index">01</span><h3>{t('settings.general')}</h3></header><div className="settings-fields">
          <label><span>{t('settings.language')}</span><select value={draft.lang} onChange={(event) => patch({ lang: event.target.value as Settings['lang'] })}><option value="sv">{t('settings.swedish')}</option><option value="en">{t('settings.english')}</option></select></label>
          <label><span>{t('settings.operator')}</span><input value={draft.operatorName} onChange={(event) => patch({ operatorName: event.target.value })} placeholder={t('settings.operatorPlaceholder')} /></label>
          <label className="form-span-2"><span>{t('settings.banner')}</span><input value={draft.bannerText} onChange={(event) => patch({ bannerText: event.target.value })} /></label>
        </div></section>
        <section className="settings-section"><header><span className="section-index">02</span><h3>{t('settings.appearance')}</h3></header><div className="settings-fields">
          <label><span>{t('settings.theme')}</span><select value={draft.theme} onChange={(event) => patch({ theme: event.target.value as Settings['theme'] })}><option value="dark">{t('settings.dark')}</option><option value="light">{t('settings.light')}</option></select></label>
          <label><span>{t('settings.density')}</span><select value={draft.density} onChange={(event) => patch({ density: event.target.value as Settings['density'] })}><option value="compact">{t('settings.compact')}</option><option value="comfortable">{t('settings.comfortable')}</option></select></label>
          <label><span>{t('settings.accent')}</span><div className="color-field"><input type="color" value={draft.accent} onChange={(event) => patch({ accent: event.target.value })} /><input className="mono-input" value={draft.accent} onChange={(event) => patch({ accent: event.target.value })} /></div></label>
        </div></section>
        <section className="settings-section"><header><span className="section-index">03</span><h3>{t('settings.ai')}</h3><span className={`llm-inline-status status-${llm.status}`}><i />{t(`llm.${llm.status}`)}</span></header><div className="settings-fields">
          <label className="form-span-2"><span>{t('settings.model')}</span><select value={draft.modelPath} onChange={(event) => patch({ modelPath: event.target.value })}><option value="">{t('settings.modelEmpty')}</option>{models.map((model) => <option value={model} key={model}>{model}</option>)}</select></label>
          <label><span>{t('settings.trigger')}</span><input type="number" min="0" max="100" value={draft.spaningsfragaTrigger} onChange={(event) => patch({ spaningsfragaTrigger: Number(event.target.value) })} /><small>{t('settings.triggerHint')}</small></label>
          <label><span>{t('settings.likelihood')}</span><textarea rows={5} value={draft.likelihoodScale.join('\n')} onChange={(event) => patch({ likelihoodScale: event.target.value.split('\n').map((value) => value.trim()).filter(Boolean) })} /><small>{t('settings.likelihoodHint')}</small></label>
        </div></section>
        <section className="settings-section"><header><span className="section-index">04</span><h3>{t('settings.system')}</h3></header><div className="settings-fields">
          <label><span>{t('settings.appPort')}</span><input className="mono-input" type="number" min="1024" max="65535" value={draft.appPort} onChange={(event) => patch({ appPort: Number(event.target.value) })} /><small>{t('settings.restartRequired')}</small></label>
          <label><span>{t('settings.llmPort')}</span><input className="mono-input" type="number" min="1024" max="65535" value={draft.llmPort} onChange={(event) => patch({ llmPort: Number(event.target.value) })} /><small>{t('settings.restartRequired')}</small></label>
          <label><span>{t('settings.backup')}</span><input type="number" min="5" max="1440" value={draft.backupIntervalMin} onChange={(event) => patch({ backupIntervalMin: Number(event.target.value) })} /></label>
          <label><span>{t('settings.logs')}</span><button className="quiet-button" type="button" onClick={() => void onClearLogs()}>{t('settings.clearLogs')}</button></label>
        </div></section>
        <section className="settings-section danger-zone"><header><span className="section-index">!</span><h3>{t('settings.danger')}</h3></header><div><strong>{t('settings.wipe')}</strong><p>{t('settings.wipeBody')}</p>{wipeStep === 0 ? <button className="danger-outline-button" type="button" onClick={() => setWipeStep(1)}>{t('settings.wipeFirst')}</button> : <div className="wipe-confirm"><label><span>{t('settings.wipePhrase')}</span><input className="mono-input" value={wipePhrase} onChange={(event) => setWipePhrase(event.target.value.toUpperCase())} placeholder={expectedPhrase} /></label><button className="danger-button" type="button" disabled={wipePhrase !== expectedPhrase || busy} onClick={() => void wipe()}>{t('settings.wipeAction')}</button></div>}</div></section>
      </div>
    </Modal>
  );
}
