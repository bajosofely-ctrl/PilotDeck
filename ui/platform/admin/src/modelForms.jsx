import React, { useState } from 'react';
import { ChevronDown, Eye, EyeOff } from 'lucide-react';
import { api, fromMicros, pathId, toMicros } from './api.js';
import { Alert, CheckField, Field, Form, IconButton, Modal, Selection } from './components.jsx';

export const protocols = [
  { id: 'openai', name: 'OpenAI Chat Completions' },
  { id: 'openai-responses', name: 'OpenAI Responses' },
  { id: 'anthropic', name: 'Anthropic Messages' },
  { id: 'google', name: 'Google Gemini' },
];
const connectionPresets = [
  { id: 'openai', name: 'OpenAI Chat（兼容接口）', protocol: 'openai', provider: 'custom' },
  { id: 'openai-official', name: 'OpenAI Chat（官方）', protocol: 'openai', provider: 'openai' },
  { id: 'ollama', name: 'Ollama（OpenAI 兼容，无需密钥）', protocol: 'openai', provider: 'ollama' },
  ...protocols.filter(item => item.id !== 'openai').map(item => ({ ...item, protocol: item.id, provider: 'custom' })),
];
export const canonicalModelName = (protocol, name) => protocol === 'google' ? name.replace(/^models\//, '') : name;
export const capabilityOptions = [
  { id: 'text', name: '文本' }, { id: 'image', name: '图片输入' },
  { id: 'tools', name: '工具调用' }, { id: 'audio', name: '音频' },
];
const appNames = { chat: '聊天', automation: '自动化', skills: '技能', learning: '学习', projects: '项目', files: '文件', terminal: '终端', computer: '电脑操作', plugins: '插件', mcp: 'MCP' };
export const appOptions = apps => apps.map(app => ({ id: app.id, name: `${appNames[app.id] || app.name}${app.enabled ? '' : '（应用已停用）'}` }));
export function newModel(values = {}) {
  return { id: `model-${crypto.randomUUID()}`, name: '', upstreamModel: '', channelId: '',
    enabled: false, inputPrice: '', outputPrice: '', maxInputTokens: 65536, maxOutputTokens: 1024,
    capabilities: ['text'], appIds: [], ...values };
}
export function modelPayload(form, creating = true) {
  return {
    ...(creating ? { id: form.id } : {}), channelId: form.channelId,
    name: form.name.trim() || form.upstreamModel.trim(), upstreamModel: form.upstreamModel.trim(),
    enabled: form.enabled, inputPriceMicros: toMicros(form.inputPrice), outputPriceMicros: toMicros(form.outputPrice),
    maxInputTokens: Number(form.maxInputTokens), maxOutputTokens: Number(form.maxOutputTokens),
    capabilities: form.capabilities, appIds: form.appIds,
  };
}

export function ChannelEditor({ channel, onClose, onSaved }) {
  const [form, setForm] = useState(() => channel ? { ...channel, apiKey: '' } : {
    id: `channel-${crypto.randomUUID()}`, name: '', provider: 'custom', protocol: 'openai', baseUrl: '', apiKey: '', enabled: false,
  });
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const presetId = form.protocol === 'openai' && form.provider === 'openai' ? 'openai-official'
    : form.protocol === 'openai' && form.provider === 'ollama' ? 'ollama' : form.protocol;
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const input = (key, props = {}) => <input {...props} value={form[key]} onChange={e => set(key, e.target.value)} />;
  const close = () => { if (!saving) onClose(); };
  return <Modal title={channel ? '编辑渠道' : '添加渠道'} onClose={close}>
    <Form onCancel={close} onSubmit={async () => {
      const endpoint = value => new URL(value).href.replace(/\/+$/, '');
      const changed = channel && (endpoint(form.baseUrl.trim()) !== endpoint(channel.baseUrl) || form.protocol !== channel.protocol);
      if (changed && channel.hasApiKey && !form.apiKey.trim()) throw new Error('地址或协议已变更，请填写新的 API Key。');
      setSaving(true);
      try {
        await api(`/admin/channels${channel ? `/${pathId(channel.id)}` : ''}`, {
          method: channel ? 'PATCH' : 'POST', body: {
            ...(!channel ? { id: form.id } : {}), name: form.name.trim(), protocol: form.protocol,
            provider: form.provider,
            baseUrl: form.baseUrl.trim(), enabled: form.enabled,
            ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
          },
        });
        onSaved();
      } finally { setSaving(false); }
    }}>
      <Field label="渠道名称">{input('name', { required: true, maxLength: 100, placeholder: '服务商或自定义名称' })}</Field>
      <Field label="服务地址">{input('baseUrl', { type: 'url', required: true, maxLength: 2048, placeholder: 'https://api.example.com/v1' })}</Field>
      <Field label="接口协议"><select value={presetId} onChange={e => {
        const preset = connectionPresets.find(item => item.id === e.target.value);
        setForm(current => ({ ...current, protocol: preset.protocol, provider: preset.provider }));
      }}>{connectionPresets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <div className="field">
        <label className="model-key-label" htmlFor="channel-api-key">{channel ? 'API Key（留空保留现有密钥）' : 'API Key'}</label>
        <div className="model-secret">
          {input('apiKey', { id: 'channel-api-key', type: showKey ? 'text' : 'password', autoComplete: 'new-password', maxLength: 8192 })}
          <IconButton label={showKey ? '隐藏密钥' : '显示密钥'} icon={showKey ? EyeOff : Eye} aria-pressed={showKey} onClick={() => setShowKey(value => !value)} />
        </div>
      </div>
      <CheckField label="启用此渠道" checked={form.enabled} onChange={e => set('enabled', e.target.checked)} />
    </Form>
  </Modal>;
}

export function ModelEditor({ model, channelId, channels, apps, onClose, onSaved }) {
  const [form, setForm] = useState(() => model ? {
    ...model, inputPrice: fromMicros(model.inputPriceMicros), outputPrice: fromMicros(model.outputPriceMicros),
    appIds: model.appIds || apps.filter(app => app.modelIds.includes(model.id)).map(app => app.id),
  } : newModel({ channelId: channelId || '' }));
  const [customName, setCustomName] = useState(Boolean(model));
  const [saving, setSaving] = useState(false);
  const set = (key, value) => {
    if (key === 'name') setCustomName(Boolean(value.trim()));
    setForm(current => ({ ...current, [key]: value, ...(key === 'upstreamModel' && !customName ? { name: value } : {}) }));
  };
  const input = (key, props = {}) => <input {...props} value={form[key]} onChange={e => set(key, e.target.value)} />;
  const channel = channels.find(item => item.id === form.channelId);
  const close = () => { if (!saving) onClose(); };
  return <Modal title={model ? '编辑模型' : '添加模型'} onClose={close}>
    <Form onCancel={close} onSubmit={async () => {
      setSaving(true);
      try {
        await api(`/admin/models${model ? `/${pathId(model.id)}` : ''}`, { method: model ? 'PATCH' : 'POST', body: modelPayload(form, !model) });
        onSaved();
      } finally { setSaving(false); }
    }}>
      <Field label="所属渠道"><select required value={form.channelId} onChange={e => set('channelId', e.target.value)}>
        <option value="">选择渠道</option>
        {channels.map(item => <option key={item.id} value={item.id}>{item.name}{item.enabled ? '' : '（已停用）'}</option>)}
      </select></Field>
      {channel && !channel.enabled && <p className="model-note">所属渠道已停用，此模型暂不会在客户端提供。</p>}
      <Field label="模型名称">{input('upstreamModel', { required: true, maxLength: 200, placeholder: '上游提供的模型名称' })}</Field>
      <Field label="显示名称">{input('name', { maxLength: 200, placeholder: '默认使用模型名称' })}</Field>
      <div className="form-grid">
        <Field label="输入售价（元 / 百万 Token）">{input('inputPrice', { type: 'number', min: 0, max: 1000000, step: '0.000001', required: true })}</Field>
        <Field label="输出售价（元 / 百万 Token）">{input('outputPrice', { type: 'number', min: 0, max: 1000000, step: '0.000001', required: true })}</Field>
      </div>
      <section className="model-section"><h3>应用范围</h3>
        <Selection options={appOptions(apps)} value={form.appIds} onChange={value => set('appIds', value)} />
        {!form.appIds.length && <p className="model-note">未分配应用，客户端不可见。</p>}
      </section>
      <details className="model-advanced" onInvalidCapture={e => { e.currentTarget.open = true; }}>
        <summary>高级设置<ChevronDown size={16} aria-hidden="true" /></summary>
        <div className="form-grid">
          <Field label="最大输入 Token">{input('maxInputTokens', { type: 'number', min: 1, max: 10000000, step: 1, required: true })}</Field>
          <Field label="最大输出 Token">{input('maxOutputTokens', { type: 'number', min: 1, max: 10000000, step: 1, required: true })}</Field>
        </div>
        <div className="model-capabilities"><h3>模型能力</h3>
          <Selection options={[...capabilityOptions, ...form.capabilities.filter(id => !capabilityOptions.some(c => c.id === id)).map(id => ({ id, name: id }))]}
            value={form.capabilities} onChange={value => set('capabilities', value)} />
        </div>
      </details>
      <CheckField label="启用此模型" checked={form.enabled} onChange={e => set('enabled', e.target.checked)} />
      {!channels.length && <Alert>请先添加一个渠道。</Alert>}
    </Form>
  </Modal>;
}
