import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface ModalProps {
  open: boolean;
  title: string;
  eyebrow?: string;
  wide?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}

export function Modal({ open, title, eyebrow, wide, children, footer, onClose }: ModalProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const cancel = (event: Event) => { event.preventDefault(); onClose(); };
    dialog.addEventListener('cancel', cancel);
    return () => dialog.removeEventListener('cancel', cancel);
  }, [onClose]);
  return (
    <dialog className={`app-dialog${wide ? ' dialog-wide' : ''}`} ref={dialogRef} onClick={(event) => { if (event.target === dialogRef.current) onClose(); }}>
      <div className="dialog-card">
        <header className="dialog-header">
          <div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2></div>
          <button className="icon-button" type="button" aria-label={t('app.close')} title={t('app.close')} onClick={onClose}><span aria-hidden="true">×</span></button>
        </header>
        <div className="dialog-content">{children}</div>
        {footer && <footer className="dialog-footer">{footer}</footer>}
      </div>
    </dialog>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({ open, title, body, confirmLabel, destructive, onConfirm, onClose }: ConfirmDialogProps) {
  const { t } = useTranslation();
  return (
    <Modal open={open} title={title} onClose={onClose} footer={
      <><button className="quiet-button" type="button" onClick={onClose}>{t('app.cancel')}</button><button className={destructive ? 'danger-button' : 'primary-button'} type="button" onClick={onConfirm}>{confirmLabel ?? t('app.confirm')}</button></>
    }>
      <p className="dialog-message">{body}</p>
    </Modal>
  );
}
