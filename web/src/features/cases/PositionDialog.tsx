import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IntelCase } from '../../types';
import { fromMgrs, toMgrs } from '../../utils';
import { Modal } from '../../components/common/Modal';

interface PositionDialogProps {
  item: IntelCase | null;
  onClose: () => void;
  onSave: (item: IntelCase, patch: Partial<IntelCase>) => Promise<void>;
}

export function PositionDialog({ item, onClose, onSave }: PositionDialogProps) {
  const { t } = useTranslation();
  const [mgrs, setMgrs] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setMgrs(item?.mgrs ?? '');
    setLat(item?.lat != null ? String(item.lat) : '');
    setLon(item?.lon != null ? String(item.lon) : '');
    setError(false);
  }, [item]);
  const save = async () => {
    if (!item) return;
    let patch: Partial<IntelCase> | null = null;
    if (mgrs.trim()) {
      const converted = fromMgrs(mgrs);
      if (converted) patch = { ...converted, position_missing: false };
    } else {
      const latitude = Number(lat);
      const longitude = Number(lon);
      const convertedMgrs = Number.isFinite(latitude) && Number.isFinite(longitude) ? toMgrs(latitude, longitude) : null;
      if (convertedMgrs) patch = { mgrs: convertedMgrs, lat: latitude, lon: longitude, position_missing: false };
    }
    if (!patch) { setError(true); return; }
    setBusy(true);
    try { await onSave(item, patch); onClose(); } finally { setBusy(false); }
  };
  return (
    <Modal open={Boolean(item)} title={t('position.title')} onClose={onClose} footer={<><button className="quiet-button" type="button" onClick={onClose}>{t('app.cancel')}</button><button className="primary-button" type="button" disabled={busy} onClick={() => void save()}>{busy && <span className="spinner" />}{t('position.save')}</button></>}>
      <p className="dialog-message">{t('position.body')}</p>
      <div className="position-form"><label className="form-span-2"><span>{t('form.mgrs')}</span><input className="mono-input" value={mgrs} onChange={(event) => { setMgrs(event.target.value.toUpperCase()); if (event.target.value) { setLat(''); setLon(''); } }} placeholder="33V WE 12345 67890" /></label><div className="or-divider"><span>{t('position.or')}</span></div><label><span>{t('form.latitude')}</span><input className="mono-input" type="number" step="any" value={lat} onChange={(event) => { setLat(event.target.value); if (event.target.value) setMgrs(''); }} /></label><label><span>{t('form.longitude')}</span><input className="mono-input" type="number" step="any" value={lon} onChange={(event) => { setLon(event.target.value); if (event.target.value) setMgrs(''); }} /></label>{error && <p className="field-error form-span-2">{t('form.invalidPosition')}</p>}</div>
    </Modal>
  );
}
