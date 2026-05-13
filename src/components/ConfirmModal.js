import React from 'react';
import '../css/ConfirmModal.css';

/**
 * ConfirmModal
 * Props:
 *   isOpen    boolean              — tampilkan modal atau tidak
 *   title     string               — judul modal
 *   message   string | ReactNode   — pesan/body modal
 *   onConfirm () => void           — callback saat OK diklik
 *   onCancel  () => void           — callback saat Cancel diklik
 *   confirmLabel  string           — label tombol OK     (default: 'OK')
 *   cancelLabel   string           — label tombol Cancel (default: 'Batal')
 */
const ConfirmModal = ({
  isOpen,
  title = 'Konfirmasi',
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'OK, Tambahkan',
  cancelLabel = 'Batal',
}) => {
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>

        {/* Accent bar */}
        <div className="modal-accent-bar" />

        {/* Body */}
        <div className="modal-body">
          <div className="modal-icon">⚠️</div>
          <div className="modal-title">{title}</div>
          <div className="modal-message">{message}</div>
        </div>

        {/* Divider */}
        <div className="modal-divider" />

        {/* Footer */}
        <div className="modal-footer">
          <button className="modal-btn-cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className="modal-btn-confirm" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>

      </div>
    </div>
  );
};

export default ConfirmModal;
