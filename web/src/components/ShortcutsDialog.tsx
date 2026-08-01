import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const shortcuts = [['/', 'search'], ['N', 'new'], ['S', 'star'], ['?', 'help'], ['Esc', 'escape']];
  return <Modal open={open} eyebrow={t('shortcuts.eyebrow')} title={t('shortcuts.title')} onClose={onClose}><div className="shortcut-list">{shortcuts.map(([key, label]) => <div key={key}><kbd>{key}</kbd><span>{t(`shortcuts.${label}`)}</span></div>)}</div></Modal>;
}
