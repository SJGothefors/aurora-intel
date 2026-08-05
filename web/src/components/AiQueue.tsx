import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiJob } from '../types';

interface AiQueueProps {
  jobs: AiJob[];
  onCancel: (job: AiJob) => void;
}

export function AiQueue({ jobs, onCancel }: AiQueueProps) {
  const { t } = useTranslation();
  const dockRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const active = jobs.filter((job) => job.status === 'pending' || job.status === 'running');
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !dockRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className="queue-dock" ref={dockRef}>
      <button className={`queue-trigger${active.length ? ' has-active' : ''}`} type="button" aria-expanded={open} title={open ? t('jobs.hide') : t('jobs.show')} onClick={() => setOpen((value) => !value)}>
        <span className="queue-pulse" aria-hidden="true" /><span>{t('jobs.title')}</span><b>{active.length}</b><span aria-hidden="true">{open ? '▾' : '▴'}</span>
      </button>
      {open && (
        <div className="queue-popover panel-float">
          <header><span className="eyebrow">{t('jobs.title')}</span><strong>{jobs.length ? t('jobs.one', { count: jobs.length }) : t('jobs.idle')}</strong></header>
          <div className="queue-list">
            {jobs.length === 0 ? <p>{t('jobs.idle')}</p> : jobs.slice(0, 8).map((job) => (
              <div className="queue-row" key={job.id}>
                <span className={`job-dot status-${job.status}`} />
                <span><strong>{t(`jobs.types.${job.type}`, { defaultValue: job.type })}</strong><small>{t(`jobs.${job.status}`)}{job.error ? ` · ${job.error}` : ''}</small></span>
                {(job.status === 'pending' || job.status === 'running') && <button className="icon-button small-icon-button" type="button" title={t('jobs.cancel')} aria-label={t('jobs.cancel')} onClick={() => onCancel(job)}>×</button>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
