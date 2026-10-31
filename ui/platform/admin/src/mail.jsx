import React, { useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { api } from './api.js';
import { Alert, Button, CheckField, Field, Form, Resource, useResource } from './components.jsx';

function MailForm({ initial }) {
  const [saved, setSaved] = useState(initial);
  const [form, setForm] = useState(initial);
  const [authorizationCode, setAuthorizationCode] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [recipient, setRecipient] = useState(initial.senderEmail);
  const [testError, setTestError] = useState('');
  const [testSuccess, setTestSuccess] = useState(false);
  const sendLock = useRef(false);
  const set = (key, value) => {
    setForm(current => ({ ...current, [key]: value }));
    setDirty(true); setTestError(''); setTestSuccess(false);
  };
  const needsCode = !saved.hasAuthorizationCode || saved.senderEmail !== form.senderEmail.trim().toLowerCase();
  return <>
    <Form submitDisabled={sending} onSubmit={async () => {
      setSaving(true);
      try {
        const result = await api('/admin/mail', { method: 'PUT', body: {
          enabled: form.enabled, senderEmail: form.senderEmail.trim(), senderName: form.senderName,
          ...(authorizationCode ? { authorizationCode } : {}),
        } });
        setSaved(result.mail); setForm(result.mail); setAuthorizationCode(''); setDirty(false);
        setTestError(''); setTestSuccess(false);
        if (!recipient) setRecipient(result.mail.senderEmail);
      } finally { setSaving(false); }
    }}>
      <section className="settings-section"><div><h2>发件配置</h2><p className="muted">QQ 邮箱 · SSL/TLS</p></div>
        <div className="settings-fields">
          <CheckField label="启用验证码邮件" checked={form.enabled} disabled={sending} onChange={event => set('enabled', event.target.checked)} />
          <div className="form-grid mail-fields">
            <Field label="发件邮箱"><input type="email" autoComplete="off" required={form.enabled} maxLength={254} disabled={sending}
              placeholder="example@qq.com" value={form.senderEmail} onChange={event => set('senderEmail', event.target.value)} /></Field>
            <Field label="发件人名称"><input required maxLength={80} disabled={sending}
              value={form.senderName} onChange={event => set('senderName', event.target.value)} /></Field>
            <Field label="SMTP 授权码" wide><input type="password" autoComplete="new-password" spellCheck={false}
              required={form.enabled && needsCode} minLength={16} maxLength={16} disabled={sending}
              placeholder={saved.hasAuthorizationCode && !needsCode ? '已保存，留空不修改' : '16 位邮箱授权码'}
              value={authorizationCode} onChange={event => { setAuthorizationCode(event.target.value); setDirty(true); setTestError(''); setTestSuccess(false); }} /></Field>
          </div>
        </div>
      </section>
    </Form>
    <section className="settings-section"><div><h2>测试邮件</h2></div>
      <form className="settings-fields" onSubmit={async event => {
        event.preventDefault();
        if (sendLock.current || dirty || saving || !saved.hasAuthorizationCode) return;
        sendLock.current = true; setSending(true); setTestError(''); setTestSuccess(false);
        try {
          await api('/admin/mail/test', { method: 'POST', body: { email: recipient.trim() } });
          setTestSuccess(true);
        } catch (error) { setTestError(error.message); }
        finally { sendLock.current = false; setSending(false); }
      }}>
        <Field label="测试收件邮箱"><input type="email" required autoComplete="off" maxLength={254} disabled={sending || saving}
          value={recipient} onChange={event => { setRecipient(event.target.value); setTestError(''); setTestSuccess(false); }} /></Field>
        <div className="mail-test-action"><Button type="submit" icon={Send} busy={sending} disabled={dirty || saving || !saved.hasAuthorizationCode}>
          发送测试邮件
        </Button>{dirty && <span className="muted">有未保存的修改，请先保存。</span>}</div>
        <Alert>{testError}</Alert>
        <Alert success>{testSuccess ? '已提交邮件服务器，请检查收件箱或垃圾邮件文件夹。' : ''}</Alert>
      </form>
    </section>
  </>;
}

export function MailPage() {
  const resource = useResource('/admin/mail');
  return <Resource resource={resource}>{data => <MailForm initial={data.mail} />}</Resource>;
}
