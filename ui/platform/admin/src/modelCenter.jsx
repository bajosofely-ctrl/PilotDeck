import React, { useState } from 'react';
import { KeyRound, ListFilter, Pencil, Plus, PlugZap, Power, Trash2 } from 'lucide-react';
import { api, money, pathId } from './api.js';
import { Action, Alert, Button, Field, IconButton, Resource, Status, Table, Toolbar, useResource } from './components.jsx';
import { appOptions, ChannelEditor, ModelEditor, protocols } from './modelForms.jsx';
import { ModelImport } from './modelImport.jsx';

function Center({ channels, models, apps, tab, setTab, refresh }) {
  const [editor, setEditor] = useState(null);
  const [discovery, setDiscovery] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [protocol, setProtocol] = useState('');
  const [channelId, setChannelId] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const channelMap = new Map(channels.map(channel => [channel.id, channel]));
  const appMap = new Map(appOptions(apps).map(app => [app.id, app.name]));
  const effective = model => model.enabled && channelMap.get(model.channelId)?.enabled;
  const channelModels = id => models.filter(model => model.channelId === id);
  const appIds = model => model.appIds || apps.filter(app => app.modelIds.includes(model.id)).map(app => app.id);
  const run = async (key, operation) => {
    if (busy) return;
    setBusy(key); setError(''); setNotice('');
    try { await operation(); } catch (err) { setError(err.message); } finally { setBusy(''); }
  };
  const saved = () => { setEditor(null); refresh(); };
  const filteredChannels = channels.filter(channel =>
    `${channel.name} ${channel.baseUrl}`.toLowerCase().includes(query.trim().toLowerCase()) &&
    (!protocol || channel.protocol === protocol) && (!status || channel.enabled === (status === 'enabled')));
  const filteredModels = models.filter(model =>
    `${model.name} ${model.upstreamModel}`.toLowerCase().includes(query.trim().toLowerCase()) &&
    (!channelId || model.channelId === channelId) && (!status || Boolean(effective(model)) === (status === 'enabled')));
  const changeTab = value => { setTab(value); setQuery(''); setStatus(''); setError(''); setNotice(''); };
  return <>
    <div className="tabs" role="tablist" aria-label="模型中心">
      <button id="channels-tab" type="button" role="tab" aria-selected={tab === 'channels'} aria-controls="model-center-panel" onClick={() => changeTab('channels')}>模型渠道 · {channels.length}</button>
      <button id="models-tab" type="button" role="tab" aria-selected={tab === 'models'} aria-controls="model-center-panel" onClick={() => changeTab('models')}>模型管理 · {models.length}</button>
    </div>
    <section id="model-center-panel" role="tabpanel" aria-labelledby={tab === 'channels' ? 'channels-tab' : 'models-tab'}>
      <Toolbar resource={{ refresh, loading: Boolean(busy) }}>
        <h2>{tab === 'channels' ? '模型渠道' : '模型管理'}</h2>
        {tab === 'models' && <span className="muted">售价单位：元 / 百万 Token</span>}
        <Button icon={Plus} className="primary" disabled={Boolean(busy) || (tab === 'models' && !channels.length)}
          onClick={() => setEditor({ type: tab === 'channels' ? 'channel' : 'model', value: null })}>
          {tab === 'channels' ? '添加渠道' : '添加模型'}
        </Button>
      </Toolbar>
      <div className="model-filters">
        <Field label={tab === 'channels' ? '搜索渠道' : '搜索模型'}><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={tab === 'channels' ? '渠道名称或地址' : '显示名称或模型名称'} /></Field>
        {tab === 'channels' ? <Field label="协议"><select value={protocol} onChange={e => setProtocol(e.target.value)}>
          <option value="">全部协议</option>{protocols.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></Field> : <Field label="渠道"><select value={channelId} onChange={e => setChannelId(e.target.value)}>
          <option value="">全部渠道</option>{channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
        </select></Field>}
        <Field label="状态"><select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">全部状态</option><option value="enabled">启用</option><option value="disabled">停用</option>
        </select></Field>
        <span className="muted model-count">共 {tab === 'channels' ? filteredChannels.length : filteredModels.length} 个{tab === 'channels' ? '渠道' : '模型'}</span>
      </div>
      <Alert>{error}</Alert><Alert success>{notice}</Alert>
      {tab === 'channels' ? <Table rows={filteredChannels} emptyTitle={channels.length ? '没有匹配的渠道' : '尚未配置渠道'}
        emptyDetail={channels.length ? '调整搜索或筛选条件。' : '添加渠道后，即可获取模型或手动添加模型。'} columns={[
          { key: 'name', label: '渠道', render: row => <div className="cell-stack wrap"><strong>{row.name}</strong><small>{row.baseUrl}</small></div> },
          { key: 'protocol', label: '协议', render: row => protocols.find(p => p.id === row.protocol)?.name || row.protocol },
          { key: 'hasApiKey', label: '密钥', render: row => <span className="inline"><KeyRound size={14} />{row.hasApiKey ? '已配置' : '未配置'}</span> },
          { key: 'count', label: '模型数', render: row => channelModels(row.id).length },
          { key: 'enabled', label: '状态', render: row => <Status value={row.enabled ? 'enabled' : 'disabled'} /> },
          { key: 'actions', label: '操作', render: row => <div className="inline">
            <Button icon={ListFilter} disabled={Boolean(busy)} onClick={() => setDiscovery(row)}>获取模型</Button>
            <Button icon={PlugZap} disabled={Boolean(busy)} busy={busy === `test-channel-${row.id}`} title="检查模型列表接口连通性"
              onClick={() => run(`test-channel-${row.id}`, async () => {
                const data = await api(`/admin/channels/${pathId(row.id)}/test`, { method: 'POST', body: {} });
                if (!data.ok) throw new Error(`${row.name}：列表接口连接失败，可尝试手动添加模型。`);
                setNotice(`${row.name}：列表接口连接成功${Number.isInteger(data.modelCount) ? `，返回 ${data.modelCount} 个模型` : ''}。`);
              })}>测试连接</Button>
            <IconButton label="编辑渠道" icon={Pencil} disabled={Boolean(busy)} onClick={() => setEditor({ type: 'channel', value: row })} />
            <IconButton label={row.enabled ? '停用渠道' : '启用渠道'} icon={Power} disabled={Boolean(busy)} onClick={() => run(`toggle-${row.id}`, async () => {
              await api(`/admin/channels/${pathId(row.id)}`, { method: 'PATCH', body: { enabled: !row.enabled } }); refresh();
            })} />
            <IconButton label="删除渠道" title={channelModels(row.id).length ? '请先将关联模型移到其他渠道' : '删除渠道'} icon={Trash2} disabled={Boolean(busy) || channelModels(row.id).length > 0} onClick={() => setRemoving(row)} />
          </div> },
        ]} /> : <Table rows={filteredModels} emptyTitle={models.length ? '没有匹配的模型' : '尚未配置模型'}
          emptyDetail={channels.length ? '添加模型，或从渠道获取模型列表。' : '请先在模型渠道中添加渠道。'} columns={[
            { key: 'name', label: '模型', render: row => <div className="cell-stack wrap"><strong>{row.name}</strong><small>{row.upstreamModel}</small></div> },
            { key: 'channelId', label: '所属渠道', render: row => channelMap.get(row.channelId)?.name || '渠道不存在' },
            { key: 'enabled', label: '状态', render: row => <div className="cell-stack"><Status value={effective(row) ? 'enabled' : 'disabled'} />{row.enabled && !channelMap.get(row.channelId)?.enabled && <small>渠道已停用</small>}</div> },
            { key: 'inputPriceMicros', label: '输入售价', render: row => money(row.inputPriceMicros) },
            { key: 'outputPriceMicros', label: '输出售价', render: row => money(row.outputPriceMicros) },
            { key: 'apps', label: '应用范围', render: row => <span className="wrap">{appIds(row).length ? appIds(row).map(id => appMap.get(id) || id).join('、') : <span className="unassigned">未分配</span>}</span> },
            { key: 'actions', label: '操作', render: row => <div className="inline">
              <IconButton label="编辑模型" icon={Pencil} disabled={Boolean(busy)} onClick={() => setEditor({ type: 'model', value: row })} />
              <Button icon={PlugZap} disabled={Boolean(busy)} busy={busy === `test-model-${row.id}`} title="向服务商发送一次短请求，费用由运营方承担"
                onClick={() => run(`test-model-${row.id}`, async () => {
                  const data = await api(`/admin/models/${pathId(row.id)}/test`, { method: 'POST', body: {} });
                  if (!data.ok) throw new Error(`${row.name}：连接失败${data.upstreamStatus ? `（${data.upstreamStatus}）` : ''}。`);
                  setNotice(`${row.name}：连接成功。`);
                })}>测试连接</Button>
              <IconButton label={row.enabled ? '停用模型' : '启用模型'} icon={Power} disabled={Boolean(busy)} onClick={() => run(`toggle-${row.id}`, async () => {
                await api(`/admin/models/${pathId(row.id)}`, { method: 'PATCH', body: { enabled: !row.enabled } }); refresh();
              })} />
            </div> },
          ]} />}
    </section>
    {editor?.type === 'channel' && <ChannelEditor channel={editor.value} onClose={() => setEditor(null)} onSaved={saved} />}
    {editor?.type === 'model' && <ModelEditor model={editor.value} channelId={editor.channelId} channels={channels} apps={apps} onClose={() => setEditor(null)} onSaved={saved} />}
    {discovery && <ModelImport channel={discovery} models={models} apps={apps} onClose={() => setDiscovery(null)}
      onManual={() => { setEditor({ type: 'model', value: null, channelId: discovery.id }); setDiscovery(null); }}
      onSaved={() => { setDiscovery(null); setTab('models'); refresh(); }} />}
    {removing && <Action title="删除渠道" description={`确定删除渠道“${removing.name}”？`} onClose={() => setRemoving(null)}
      onConfirm={async () => { await api(`/admin/channels/${pathId(removing.id)}`, { method: 'DELETE' }); refresh(); }} />}
  </>;
}

export function ModelsPage() {
  const channels = useResource('/admin/channels');
  const models = useResource('/admin/models');
  const apps = useResource('/admin/apps');
  const [tab, setTab] = useState('channels');
  const refresh = () => { channels.refresh(); models.refresh(); apps.refresh(); };
  return <Resource resource={channels}>{channelData => <Resource resource={models}>{modelData => <Resource resource={apps}>{appData =>
    <Center channels={channelData.channels} models={modelData.models} apps={appData.apps} tab={tab} setTab={setTab} refresh={refresh} />
  }</Resource>}</Resource>}</Resource>;
}
