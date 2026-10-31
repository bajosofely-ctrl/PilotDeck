import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Inbox, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { api } from './api.js';

export function useResource(path) {
  const [state, setState] = useState({ data: null, loading: true, error: '' });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ data: null, loading: true, error: '' });
    api(path, { signal: controller.signal })
      .then((data) => setState({ data, loading: false, error: '' }))
      .catch((error) => {
        if (error.name !== 'AbortError') setState({ data: null, loading: false, error: error.message });
      });
    return () => controller.abort();
  }, [path, revision]);
  return { ...state, refresh: () => setRevision((r) => r + 1) };
}

export function Alert({ children, success = false }) {
  if (!children) return null;
  const Icon = success ? Check : AlertCircle;
  return <div role={success ? 'status' : 'alert'} className={`notice ${success ? 'success' : 'error'}`}><Icon size={17} /><span>{children}</span></div>;
}

export function Button({ children, icon: Icon, busy, className = '', ...props }) {
  return <button className={`button ${className}`} {...props} disabled={props.disabled || busy}>
    {busy ? <LoaderCircle size={16} className="spin" /> : Icon && <Icon size={16} />}
    {children}
  </button>;
}

export function IconButton({ label, icon: Icon, ...props }) {
  return <button type="button" className="icon-button" aria-label={label} title={label} {...props}><Icon size={17} /></button>;
}

export function Field({ label, children, wide = false }) {
  return <label className={`field ${wide ? 'wide' : ''}`}><span>{label}</span>{children}</label>;
}

export function CheckField({ label, ...props }) {
  return <label className="check"><input type="checkbox" {...props} /><span>{label}</span></label>;
}

export function Form({ onSubmit, children, submitLabel = '保存', submitDisabled = false, onCancel }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const lock = useRef(false);
  return <form onChange={() => setSaved(false)} onSubmit={async (event) => {
    event.preventDefault();
    if (lock.current || submitDisabled) return;
    lock.current = true;
    setBusy(true); setError(''); setSaved(false);
    try { await onSubmit(); setSaved(true); }
    catch (err) { setError(err.message); }
    finally { lock.current = false; setBusy(false); }
  }}>
    <fieldset disabled={busy} className="form-fields">{children}</fieldset>
    <Alert>{error}</Alert>
    <Alert success>{saved ? '已保存。' : ''}</Alert>
    <div className="form-actions">
      {onCancel && <Button type="button" onClick={onCancel} disabled={busy}>取消</Button>}
      <Button type="submit" className="primary" busy={busy} disabled={submitDisabled}>{submitLabel}</Button>
    </div>
  </form>;
}

export function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className={wide ? 'modal large' : 'modal'} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header className="modal-heading"><h2>{title}</h2><IconButton label="关闭" icon={X} onClick={onClose} /></header>
    <div className="modal-content">{children}</div>
  </dialog>;
}

export function Resource({ resource, children }) {
  if (resource.loading) return <div className="loading" role="status"><LoaderCircle size={20} className="spin" />正在加载…</div>;
  if (resource.error) return <div className="resource-error"><Alert>{resource.error}</Alert><Button icon={RefreshCw} onClick={resource.refresh}>重试</Button></div>;
  return children(resource.data);
}

export function Empty({ title = '暂无记录', detail = '符合条件的记录将显示在这里。' }) {
  return <div className="empty"><Inbox size={30} strokeWidth={1.4} /><strong>{title}</strong><span>{detail}</span></div>;
}

export function Table({ columns, rows, rowKey = 'id', emptyTitle, emptyDetail }) {
  if (!rows.length) return <Empty title={emptyTitle} detail={emptyDetail} />;
  return <div className="table-scroll"><table><thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead>
    <tbody>{rows.map((row, i) => <tr key={row[rowKey] ?? i}>{columns.map((column) => <td key={column.key}>{column.render ? column.render(row) : row[column.key] ?? '—'}</td>)}</tr>)}</tbody>
  </table></div>;
}

const labels = {
  active: '正常', disabled: '停用', enabled: '启用', unused: '未兑换', redeemed: '已兑换',
  revoked: '已作废', expired: '已过期', pending: '待核查', pending_review: '待核查',
  completed: '已完成', settled: '已结算', failed: '失败', cancelled: '已取消',
  reserved: '已预留', released: '已释放', admin: '管理员', user: '用户',
  adjustment: '人工调整', redemption: '兑换充值', redeem: '兑换充值', signup_gift: '注册赠送',
  usage: '模型消费', charge: '消费', refund: '退回',
};
export function Status({ value }) {
  return <span className={`status status-${value}`}>{labels[value] || value || '—'}</span>;
}

export function Toolbar({ children, resource }) {
  return <div className="toolbar">{children}<div className="toolbar-spacer" />{resource && <IconButton label="刷新数据" icon={RefreshCw} onClick={resource.refresh} disabled={resource.loading} />}</div>;
}

export function Selection({ options, value, onChange }) {
  return <div className="selection">{options.map((option) => <CheckField key={option.id} label={option.name || option.id}
    checked={value.includes(option.id)} onChange={(e) => onChange(e.target.checked ? [...value, option.id] : value.filter((id) => id !== option.id))} />)}</div>;
}

export function Action({ title, description, onConfirm, onClose, children }) {
  return <Modal title={title} onClose={onClose}><p className="description">{description}</p><Form onSubmit={async () => { await onConfirm(); onClose(); }} onCancel={onClose} submitLabel="确认">{children}</Form></Modal>;
}
