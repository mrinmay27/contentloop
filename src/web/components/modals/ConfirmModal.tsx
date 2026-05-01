import React from 'react';
import { Icon } from '../ui/Icon';

type Props = {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export const ConfirmModal: React.FC<Props> = ({
  title, message, confirmLabel = 'Delete', onConfirm, onCancel
}) => (
  <div className="modal-overlay" onClick={onCancel}>
    <div
      className="modal-box"
      style={{ width: 420, maxHeight: 'unset' }}
      onClick={e => e.stopPropagation()}
    >
      <div className="modal-header" style={{ paddingBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'var(--red-dim)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', flexShrink: 0
          }}>
          <Icon name="trash" size={14}/>
          </div>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
            {title}
          </div>
        </div>
        <button className="btn-icon" onClick={onCancel}>
          <Icon name="x" size={14}/>
        </button>
      </div>

      <div style={{ padding: '16px 24px', color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6 }}>
        {message}
      </div>

      <div className="modal-footer" style={{ justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn btn-danger" onClick={onConfirm}
          style={{ background: 'var(--red)', color: '#fff' }}>
          <Icon name="trash" size={12}/> {confirmLabel}
        </button>
      </div>
    </div>
  </div>
);
