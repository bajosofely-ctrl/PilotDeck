import React, { useState } from 'react';
import { api, fromMicros, toMicros } from './api.js';
import { CheckField, Field, Form, Resource, Selection, Toolbar, useResource } from './components.jsx';
export { ModelsPage } from './modelCenter.jsx';

const appLabels = { chat: '聊天', automation: '自动化', skills: '技能', learning: '学习', projects: '项目', files: '文件', terminal: '终端', computer: '电脑操作', plugins: '插件', mcp: 'MCP' };
const nameApps = (apps) => apps.map((app) => ({ ...app, name: appLabels[app.id] || app.name }));
const availability = model => !model.enabled ? '（已停用）' : model.channelEnabled === false ? '（渠道已停用）' : '';

function AppsForm({ initial, models, onSaved }) {
  const [apps, setApps] = useState(initial);
  const update = (id, values) => setApps((current) => current.map((app) => app.id === id ? { ...app, ...values } : app));
  return <Form onSubmit={async () => {
    await api('/admin/apps', { method: 'PUT', body: { apps: apps.map(({ id, name, enabled, defaultModelId, modelIds }) => ({ id, name, enabled, defaultModelId: defaultModelId || null, modelIds })) } }); onSaved();
  }}>
    <div className="app-settings">{apps.map((app) => <section className="app-row" key={app.id}>
      <div className="app-heading"><h3>{appLabels[app.id] || app.name}</h3><span className="mono muted">{app.id}</span><CheckField label="启用" checked={app.enabled} onChange={(e) => update(app.id, { enabled: e.target.checked })} /></div>
      <div className="app-controls"><div><span className="field-label">允许使用的模型</span>
        {models.length ? <Selection options={models.map((model) => ({ id: model.id, name: `${model.name}${availability(model)}` }))}
          value={app.modelIds} onChange={(value) => update(app.id, { modelIds: value, defaultModelId: value.includes(app.defaultModelId) ? app.defaultModelId : null })} /> : <span className="muted">暂无可分配模型</span>}</div>
        <Field label="默认模型"><select value={app.defaultModelId || ''} onChange={(e) => update(app.id, { defaultModelId: e.target.value || null })}><option value="">未指定</option>{models.filter((model) => app.modelIds.includes(model.id)).map((model) => <option key={model.id} value={model.id}>{model.name}{availability(model)}</option>)}</select></Field>
      </div>
    </section>)}</div>
  </Form>;
}

export function AppsPage() {
  const apps = useResource('/admin/apps');
  const models = useResource('/admin/models');
  return <><Toolbar resource={apps}><h2>应用与模型分配</h2></Toolbar><Resource resource={apps}>{(data) => <Resource resource={models}>{(catalog) =>
    <AppsForm initial={data.apps} models={catalog.models} onSaved={() => {}} />
  }</Resource>}</Resource></>;
}

function SettingsForm({ initial, apps }) {
  const [form, setForm] = useState({ ...initial, giftAmount: fromMicros(initial.giftAmountMicros) });
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return <Form onSubmit={async () => {
    await api('/admin/settings', { method: 'PUT', body: {
      registrationEnabled: form.registrationEnabled, deviceLimit: Number(form.deviceLimit), concurrencyLimit: Number(form.concurrencyLimit),
      defaultApps: form.defaultApps, giftEnabled: form.giftEnabled, giftAmountMicros: toMicros(form.giftAmount),
      giftExpiryDays: form.giftExpiryDays === '' || form.giftExpiryDays === null ? null : Number(form.giftExpiryDays),
    } });
  }}>
    <section className="settings-section"><div><h2>账号注册</h2></div><div className="settings-fields">
      <CheckField label="开放邮箱注册" checked={form.registrationEnabled} onChange={(e) => set('registrationEnabled', e.target.checked)} />
      <div className="form-grid"><Field label="默认设备上限"><input type="number" min="1" max="100" required value={form.deviceLimit} onChange={(e) => set('deviceLimit', e.target.value)} /></Field>
        <Field label="默认请求并发上限"><input type="number" min="1" max="100" required value={form.concurrencyLimit} onChange={(e) => set('concurrencyLimit', e.target.value)} /></Field></div>
    </div></section>
    <section className="settings-section"><div><h2>新用户默认权限</h2></div><div className="settings-fields"><Selection options={nameApps(apps)} value={form.defaultApps} onChange={(value) => set('defaultApps', value)} /></div></section>
    <section className="settings-section"><div><h2>注册赠送</h2></div><div className="settings-fields">
      <CheckField label="启用注册赠送" checked={form.giftEnabled} onChange={(e) => set('giftEnabled', e.target.checked)} />
      <div className="form-grid"><Field label="赠送金额（元）"><input type="number" min="0" step="0.000001" required value={form.giftAmount} onChange={(e) => set('giftAmount', e.target.value)} /></Field>
        <Field label="有效天数（留空为长期有效）"><input type="number" min="1" step="1" value={form.giftExpiryDays ?? ''} onChange={(e) => set('giftExpiryDays', e.target.value)} /></Field></div>
    </div></section>
  </Form>;
}

export function SettingsPage() {
  const settings = useResource('/admin/settings');
  const apps = useResource('/admin/apps');
  return <><Toolbar resource={settings}><h2>注册策略</h2></Toolbar><Resource resource={settings}>{(data) => <Resource resource={apps}>{(appData) =>
    <SettingsForm initial={data.settings} apps={appData.apps} />
  }</Resource>}</Resource></>;
}
