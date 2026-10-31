import React, { useEffect, useRef, useState } from 'react';
import { Download, Plus, RefreshCw } from 'lucide-react';
import { api, pathId, toMicros } from './api.js';
import { Alert, Button, CheckField, Field, Form, Modal, Selection, Status } from './components.jsx';
import { appOptions, canonicalModelName, modelPayload, newModel } from './modelForms.jsx';

export function ModelImport({ channel, models, apps, onClose, onManual, onSaved }) {
  const [rows, setRows] = useState(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [prices, setPrices] = useState({ input: '', output: '' });
  const [appIds, setAppIds] = useState([]);
  const request = useRef(null);
  const existing = new Set(models.filter(model => model.channelId === channel.id).map(model => canonicalModelName(channel.protocol, model.upstreamModel)));
  const discover = async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setError('');
    try {
      const data = await api(`/admin/channels/${pathId(channel.id)}/discover`, { method: 'POST', body: {}, signal: controller.signal });
      if (request.current !== controller || controller.signal.aborted) return;
      if (!Array.isArray(data.models)) throw new Error('服务返回了无效模型列表。');
      const unique = [...new Map(data.models.filter(item => typeof item?.id === 'string' && item.id.trim())
        .map(item => [canonicalModelName(channel.protocol, item.id.trim()), item])).values()];
      setRows(unique.map(item => ({
        ...newModel({ channelId: channel.id, upstreamModel: item.id.trim(), name: (item.name || item.id).slice(0, 200) }),
        selected: false, imported: existing.has(canonicalModelName(channel.protocol, item.id.trim())),
      })));
      setTruncated(data.truncated === true);
    } catch (err) {
      if (request.current === controller && !controller.signal.aborted) setError(err.message);
    } finally {
      if (request.current === controller) { request.current = null; setLoading(false); }
    }
  };
  useEffect(() => {
    void discover();
    return () => { request.current?.abort(); request.current = null; };
  }, [channel.id]);
  const update = (id, values) => setRows(current => current.map(row => row.id === id ? { ...row, ...values } : row));
  const selected = (rows || []).filter(row => row.selected && !row.imported);
  const visible = (rows || []).filter(row =>
    `${row.upstreamModel} ${row.name}`.toLowerCase().includes(query.trim().toLowerCase()) &&
    (filter === 'all' || (filter === 'imported' ? row.imported : !row.imported)));
  const selectable = visible.filter(row => !row.imported);
  const close = () => { if (!saving) onClose(); };
  return <Modal wide title={`获取模型 · ${channel.name}`} onClose={close}>
    <div className="import-heading">
      <span className="muted">{rows ? `获取到 ${rows.length} 个模型` : '模型列表'}</span>
      <Button type="button" icon={RefreshCw} busy={loading} disabled={saving} onClick={discover}>重新获取</Button>
      <Button type="button" icon={Plus} disabled={saving} onClick={onManual}>手动添加模型</Button>
    </div>
    <Alert>{error}</Alert>
    {loading && <p role="status" className="model-note">正在获取模型列表…</p>}
    {rows?.length === 0 && <p role="status" className="model-note">未获取到模型，可手动添加。</p>}
    {truncated && <p role="status" className="model-note">仅返回部分模型，未列出的模型可手动添加。</p>}
    {rows?.length > 0 && <Form onCancel={close} submitLabel="导入选中模型" submitDisabled={loading || !selected.length} onSubmit={async () => {
      if (!selected.length) throw new Error('请至少选择一个未导入的模型。');
      if (selected.length > 100) throw new Error('每次最多导入 100 个模型。');
      // Hidden selected rows must be validated as well as the visible HTML inputs.
      const payload = selected.map(row => {
        if (row.inputPrice === '' || row.outputPrice === '') throw new Error(`请填写 ${row.upstreamModel} 的输入和输出售价。`);
        const result = modelPayload({ ...row, appIds });
        delete result.channelId;
        return result;
      });
      setSaving(true);
      try {
        const data = await api(`/admin/channels/${pathId(channel.id)}/import`, { method: 'POST', body: { models: payload } });
        onSaved(data);
      } finally { setSaving(false); }
    }}>
      <div className="model-filters import-filters">
        <Field label="搜索模型"><input type="search" value={query} onChange={e => setQuery(e.target.value)} /></Field>
        <Field label="导入状态"><select value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="all">全部模型</option><option value="new">未导入</option><option value="imported">已导入</option>
        </select></Field>
      </div>
      <div className="import-bulk">
        <Field label="输入售价（元 / 百万 Token）"><input type="number" min="0" max="1000000" step="0.000001" value={prices.input} onChange={e => setPrices(current => ({ ...current, input: e.target.value }))} /></Field>
        <Field label="输出售价（元 / 百万 Token）"><input type="number" min="0" max="1000000" step="0.000001" value={prices.output} onChange={e => setPrices(current => ({ ...current, output: e.target.value }))} /></Field>
        <Button type="button" icon={Download} disabled={!selected.length || loading} onClick={() => {
          try {
            const input = toMicros(prices.input), output = toMicros(prices.output);
            if (input < 0 || output < 0 || input > 1000000000000 || output > 1000000000000) throw new Error('售价应为 0 到 1000000 元。');
            setRows(current => current.map(row => row.selected && !row.imported ? { ...row, inputPrice: prices.input, outputPrice: prices.output } : row));
            setError('');
          } catch (err) { setError(err.message); }
        }}>应用到已选</Button>
      </div>
      <div className="import-summary"><CheckField label="全选当前结果" checked={selectable.length > 0 && selectable.every(row => row.selected)}
        disabled={!selectable.length || loading} onChange={e => {
          const ids = new Set(selectable.map(row => row.id)), checked = e.target.checked;
          setRows(current => current.map(row => ids.has(row.id) ? { ...row, selected: checked } : row));
        }} /><span className="muted">已选择 {selected.length} 个 · 当前结果 {visible.length} 个</span></div>
      <div className="table-scroll import-table"><table>
        <thead><tr><th>选择</th><th>模型</th><th>能力</th><th>输入售价</th><th>输出售价</th><th>启用</th><th>状态</th></tr></thead>
        <tbody>{visible.map(row => <tr key={row.id}>
          <td><input type="checkbox" aria-label={`选择 ${row.upstreamModel}`} disabled={row.imported || loading} checked={row.selected} onChange={e => update(row.id, { selected: e.target.checked })} /></td>
          <td><div className="cell-stack"><input aria-label={`名称 ${row.upstreamModel}`} maxLength={200} value={row.name} disabled={row.imported || !row.selected || loading} onChange={e => update(row.id, { name: e.target.value })} /><small>{row.upstreamModel}</small></div></td>
          <td><select aria-label={`能力 ${row.upstreamModel}`} disabled={row.imported || !row.selected || loading} value={row.capabilities.join(',')} onChange={e => update(row.id, { capabilities: e.target.value.split(',') })}>
            <option value="text">文本</option><option value="text,image">文本、图片输入</option><option value="text,tools">文本、工具调用</option><option value="text,image,tools">文本、图片、工具</option>
          </select></td>
          <td><input aria-label={`输入售价 ${row.upstreamModel}`} type="number" min="0" max="1000000" step="0.000001" required={row.selected} disabled={row.imported || !row.selected || loading} value={row.inputPrice} onChange={e => update(row.id, { inputPrice: e.target.value })} /></td>
          <td><input aria-label={`输出售价 ${row.upstreamModel}`} type="number" min="0" max="1000000" step="0.000001" required={row.selected} disabled={row.imported || !row.selected || loading} value={row.outputPrice} onChange={e => update(row.id, { outputPrice: e.target.value })} /></td>
          <td><input aria-label={`启用 ${row.upstreamModel}`} type="checkbox" disabled={row.imported || !row.selected || loading} checked={row.enabled} onChange={e => update(row.id, { enabled: e.target.checked })} /></td>
          <td>{row.imported ? <span className="status">已导入</span> : <Status value={row.enabled ? 'enabled' : 'disabled'} />}</td>
        </tr>)}</tbody>
      </table>{!visible.length && <p className="model-note">没有匹配的模型。</p>}</div>
      <section className="model-section"><h3>应用范围</h3><Selection options={appOptions(apps)} value={appIds} onChange={setAppIds} />
        {!appIds.length && <p className="model-note">未分配应用，客户端不可见。</p>}
        {!channel.enabled && <p className="model-note">所属渠道已停用，导入后暂不会在客户端提供。</p>}
      </section>
    </Form>}
  </Modal>;
}
