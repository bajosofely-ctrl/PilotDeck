import React, { useState } from 'react';
import { Download, ExternalLink, Plus, Search } from 'lucide-react';
import { api, date, exportCsv, money, pathId, toMicros } from './api.js';
import { Action, Alert, Button, Field, Form, Modal, Resource, Status, Table, Toolbar, useResource } from './components.jsx';

const codeColumns = [['兑换码', 'code'], ['面值（微元）', 'amountMicros'], ['状态', 'status'], ['批次', 'batchId'], ['截止时间', 'expiresAt'], ['兑换用户', 'redeemedBy'], ['兑换时间', 'redeemedAt'], ['入账流水', 'ledgerId']];

function CodeGenerator({ onClose, onSaved }) {
  const [amount, setAmount] = useState('');
  const [count, setCount] = useState('1');
  const [expires, setExpires] = useState('');
  const [attempt, setAttempt] = useState(null);
  const [generated, setGenerated] = useState(null);
  return <Modal title={generated ? '兑换码已生成' : '批量生成兑换码'} onClose={onClose} wide={Boolean(generated)}>
    {generated ? <>
      <div className="toolbar"><span>共 {generated.length} 个兑换码</span><Button icon={Download} className="primary" onClick={() => exportCsv('兑换码-新批次.csv', codeColumns, generated)}>导出本批次</Button></div>
      <Table rows={generated} columns={[{ key: 'code', label: '兑换码', render: (row) => <code className="selectable">{row.code}</code> }, { key: 'amountMicros', label: '面值', render: (row) => money(row.amountMicros) }, { key: 'expiresAt', label: '截止时间', render: (row) => row.expiresAt ? date(row.expiresAt) : '长期有效' }]} />
    </> : <Form submitLabel={attempt ? '重试生成' : '生成兑换码'} onCancel={onClose} onSubmit={async () => {
      const amountMicros = toMicros(amount);
      if (amountMicros <= 0) throw new Error('面值必须大于零。');
      const expiresAt = expires ? new Date(expires).getTime() : null;
      if (!attempt && expiresAt && expiresAt <= Date.now()) throw new Error('兑换截止时间必须晚于当前时间。');
      const body = attempt || { amountMicros, count: Number(count), expiresAt, requestId: crypto.randomUUID() };
      setAttempt(body);
      let result;
      try { result = await api('/admin/codes', { method: 'POST', body }); }
      catch (error) { if (error.status && error.status < 500) setAttempt(null); throw error; }
      setGenerated(result.codes); onSaved();
    }}>
      <fieldset disabled={Boolean(attempt)} className="form-fields">
        <Field label="单码面值（元）"><input type="number" min="0.000001" step="0.000001" required value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="生成数量"><input type="number" min="1" max="1000" step="1" required value={count} onChange={(e) => setCount(e.target.value)} /></Field>
        <Field label="兑换截止时间（留空为长期有效）"><input type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} /></Field>
      </fieldset>
    </Form>}
  </Modal>;
}

export function CodesPage() {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [create, setCreate] = useState(false);
  const [revoke, setRevoke] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [batch, setBatch] = useState('');
  const [batchQuery, setBatchQuery] = useState('');
  const resourcePath = `/admin/codes?limit=500${batchQuery ? `&batchId=${encodeURIComponent(batchQuery)}` : ''}`;
  const resource = useResource(resourcePath);
  return <><Toolbar resource={resource}>
    <Field label="状态"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">全部状态</option><option value="unused">未兑换</option><option value="redeemed">已兑换</option><option value="expired">已过期</option><option value="revoked">已作废</option></select></Field>
    <form className="search" onSubmit={(e) => { e.preventDefault(); setBatchQuery(batch.trim()); }}><Search size={17} /><input aria-label="兑换码批次 ID" placeholder="按批次 ID 查询" value={batch} onChange={(e) => setBatch(e.target.value)} /><Button type="submit">查询</Button></form>
    <Button icon={Plus} className="primary" onClick={() => setCreate(true)}>批量生成</Button>
  </Toolbar><div className="toolbar"><input className="list-filter" aria-label="筛选当前列表兑换码" placeholder="筛选编号、批次或兑换用户" value={search} onChange={(e) => setSearch(e.target.value)} /></div><Alert>{exportError}</Alert>
    <Resource resource={resource}>{({ codes }) => {
      const rows = codes.filter((row) => (!status || row.status === status) && [row.code, row.id, row.batchId, row.redeemedBy].some((value) => String(value || '').toLowerCase().includes(search.toLowerCase())));
      return <><div className="list-summary"><span>最近 500 条中匹配 {rows.length} 条</span><Button icon={Download} busy={exporting} disabled={!rows.length} onClick={async () => {
        setExporting(true); setExportError('');
        try {
          const revealed = await api(`${resourcePath}&export=true`);
          const ids = new Set(rows.map((row) => row.id));
          const records = revealed.codes.filter((row) => ids.has(row.id));
          if (records.length !== rows.length) throw new Error('列表已更新，请刷新数据后重新导出。');
          exportCsv('兑换码-当前列表.csv', codeColumns, records);
        } catch (error) { setExportError(error.message); }
        finally { setExporting(false); }
      }}>导出当前列表</Button></div>
        <Table rows={rows} emptyTitle="暂无兑换码" emptyDetail="尚无符合条件的兑换码，可调整筛选或生成新批次。" columns={[
          { key: 'code', label: '兑换码编号 / 批次', render: (row) => <div className="cell-stack"><code>{row.id}</code><small>{row.batchId}</small></div> },
          { key: 'amountMicros', label: '面值', render: (row) => money(row.amountMicros) },
          { key: 'status', label: '状态', render: (row) => <Status value={row.status} /> },
          { key: 'expiresAt', label: '兑换截止时间', render: (row) => row.expiresAt ? date(row.expiresAt) : '长期有效' },
          { key: 'redeemedBy', label: '兑换归属', render: (row) => <div className="cell-stack"><span>{row.redeemedBy || '—'}</span><small>{row.redeemedAt ? date(row.redeemedAt) : ''}</small></div> },
          { key: 'action', label: '操作', render: (row) => <Button className="danger subtle" disabled={row.status !== 'unused'} onClick={() => setRevoke(row)}>作废</Button> },
        ]} /></>;
    }}</Resource>
    {create && <CodeGenerator onClose={() => setCreate(false)} onSaved={resource.refresh} />}
    {revoke && <Action title="作废兑换码" description={`兑换码 ${revoke.code || revoke.id} 作废后将无法兑换。`} onClose={() => setRevoke(null)} onConfirm={async () => {
      await api(`/admin/codes/${pathId(revoke.id)}/revoke`, { method: 'POST', body: {} }); resource.refresh();
    }} />}
  </>;
}

export function LedgerTable({ rows }) {
  return <Table rows={rows} emptyTitle="暂无资金流水" emptyDetail="充值、赠送、消费和人工调整发生后，将在此留下记录。" columns={[
    { key: 'createdAt', label: '时间', render: (row) => date(row.createdAt) },
    { key: 'userId', label: '用户', render: (row) => <span className="identifier" title={row.userId}>{row.email || row.userId}</span> },
    { key: 'kind', label: '类型', render: (row) => <Status value={row.kind} /> },
    { key: 'call', label: '调用用量 / 当次售价', render: (row) => row.call ? <div className="cell-stack">
      <span>{row.call.appId} · {row.call.modelId}</span>
      <small>输入 {row.call.inputTokens ?? '待核查'} / 输出 {row.call.outputTokens ?? '待核查'} Token</small>
      <small>输入 {money(row.call.inputPriceMicros)} / 输出 {money(row.call.outputPriceMicros)} 每百万 Token</small>
      <Status value={row.call.status} />
    </div> : '—' },
    { key: 'amountMicros', label: '变动金额', render: (row) => {
      const amount = row.amountUnits == null ? row.amountMicros : Number(row.amountUnits) / 1e6;
      return <span className={amount < 0 ? 'amount-negative' : 'amount-positive'}>{money(amount)}</span>;
    } },
    { key: 'reason', label: '原因 / 关联记录', render: (row) => <div className="cell-stack wrap"><span>{row.reason || '—'}</span><small>{row.reference || row.callId || row.id}</small></div> },
    { key: 'actorId', label: '操作人', render: (row) => row.actorId || '系统' },
  ]} />;
}

function Review({ call, onClose, onSaved }) {
  const [action, setAction] = useState('release');
  const [inputTokens, setInputTokens] = useState('');
  const [outputTokens, setOutputTokens] = useState('');
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [attempt, setAttempt] = useState(null);
  return <Modal title="核查异常请求" onClose={onClose}><p className="description">请求 {call.id} · 预留 {money(call.reservedMicros)}</p>
    <Form onCancel={onClose} submitLabel={attempt ? '重试核查' : action === 'release' ? '确认释放预留' : '确认按用量结算'} onSubmit={async () => {
      const body = attempt || { action, reason: reason.trim(), evidence: evidence.trim(), requestId: crypto.randomUUID(),
        ...(action === 'settle' ? { inputTokens: Number(inputTokens), outputTokens: Number(outputTokens) } : {}),
      };
      if (!body.reason || !body.evidence) throw new Error('请填写核查原因与凭据。');
      setAttempt(body);
      try { await api(`/admin/billing/calls/${pathId(call.id)}/review`, { method: 'POST', body }); }
      catch (error) { if (error.status && error.status < 500) setAttempt(null); throw error; }
      onSaved(); onClose();
    }}>
      <fieldset disabled={Boolean(attempt)} className="form-fields">
        <Field label="处理方式"><select value={action} onChange={(e) => setAction(e.target.value)}><option value="release">释放预留（核实无消费）</option><option value="settle">按核实用量结算</option></select></Field>
        {action === 'settle' && <div className="form-grid"><Field label="核实输入 Token"><input type="number" min="0" step="1" max={call.inputBound} required value={inputTokens} onChange={(e) => setInputTokens(e.target.value)} /></Field>
          <Field label="核实输出 Token"><input type="number" min="0" step="1" max={call.outputBound} required value={outputTokens} onChange={(e) => setOutputTokens(e.target.value)} /></Field></div>}
        <Field label="核查原因"><textarea rows={3} required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <Field label="核查凭据 / 服务商工单"><textarea rows={2} required maxLength={500} value={evidence} onChange={(e) => setEvidence(e.target.value)} /></Field>
      </fieldset>
    </Form>
  </Modal>;
}

function PendingPage() {
  const resource = useResource('/admin/billing/pending?limit=500');
  const [review, setReview] = useState(null);
  return <><Toolbar resource={resource}><h3>异常待核查（最早 500 条）</h3></Toolbar><Resource resource={resource}>{({ calls }) => <Table rows={calls} emptyTitle="暂无待核查请求" emptyDetail="缺少可核实用量的请求将在此显示。" columns={[
    { key: 'createdAt', label: '请求时间', render: (row) => date(row.createdAt) },
    { key: 'id', label: '请求', render: (row) => <div className="cell-stack"><code>{row.id}</code><small>{row.userId}</small></div> },
    { key: 'modelId', label: '应用 / 模型', render: (row) => <div className="cell-stack"><span>{row.appId}</span><small>{row.modelId}</small></div> },
    { key: 'status', label: '状态', render: (row) => <Status value={row.status} /> },
    { key: 'reservedMicros', label: '预留金额', render: (row) => money(row.reservedMicros) },
    { key: 'reason', label: '异常原因', render: (row) => <span className="wrap">{row.reason || row.error || '未取得可核实用量'}</span> },
    { key: 'action', label: '操作', render: (row) => <Button onClick={() => setReview(row)}>核查处理</Button> },
  ]} />}</Resource>{review && <Review call={review} onClose={() => setReview(null)} onSaved={resource.refresh} />}</>;
}

function LedgerList() {
  const [user, setUser] = useState('');
  const [query, setQuery] = useState('');
  const resource = useResource(`/admin/ledger?limit=500${query ? `&userId=${encodeURIComponent(query)}` : ''}`);
  return <><Toolbar resource={resource}>
    <form className="search" onSubmit={(e) => { e.preventDefault(); setQuery(user.trim()); }}><Search size={17} /><input aria-label="账务用户 ID" placeholder="按用户 ID 查询" value={user} onChange={(e) => setUser(e.target.value)} /><Button type="submit">查询</Button></form>
  </Toolbar><Resource resource={resource}>{({ ledger }) => <><div className="list-summary"><span>最近 500 条中显示 {ledger.length} 条</span><Button icon={Download} disabled={!ledger.length} onClick={() => exportCsv('资金流水.csv',
    [['流水 ID', 'id'], ['时间', 'createdAt'], ['用户 ID', 'userId'], ['类型', 'kind'], ['金额（微元）', 'amountMicros'], ['精确金额（万亿分之一元）', 'amountUnits'],
      ['应用', 'appId'], ['模型', 'modelId'], ['输入 Token', 'inputTokens'], ['输出 Token', 'outputTokens'],
      ['输入售价（微元/百万 Token）', 'inputPriceMicros'], ['输出售价（微元/百万 Token）', 'outputPriceMicros'], ['原因', 'reason'], ['操作人', 'actorId']],
    ledger.map(row => ({ ...row, appId: row.call?.appId, modelId: row.call?.modelId, inputTokens: row.call?.inputTokens,
      outputTokens: row.call?.outputTokens, inputPriceMicros: row.call?.inputPriceMicros, outputPriceMicros: row.call?.outputPriceMicros })))}>导出当前列表</Button></div><LedgerTable rows={ledger} /></>}</Resource></>;
}

export function LedgerPage() {
  const [tab, setTab] = useState('ledger');
  return <><div className="tabs" role="tablist" aria-label="账务分类"><button role="tab" aria-selected={tab === 'ledger'} onClick={() => setTab('ledger')}>资金流水</button><button role="tab" aria-selected={tab === 'pending'} onClick={() => setTab('pending')}>异常待核查</button></div>
    {tab === 'ledger' ? <LedgerList /> : <PendingPage />}</>;
}

function ReleaseEditor({ onClose, onSaved }) {
  const [form, setForm] = useState({ version: '', notes: '', downloadUrl: '', sha256: '', sizeBytes: '', platform: 'win32-x64' });
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return <Modal title="发布客户端版本" onClose={onClose} wide><Form submitLabel="发布版本" onCancel={onClose} onSubmit={async () => {
    if (new URL(form.downloadUrl).protocol !== 'https:') throw new Error('安装包下载地址必须使用 HTTPS。');
    await api('/admin/releases', { method: 'POST', body: { ...form, version: form.version.trim(), sha256: form.sha256.trim(), sizeBytes: Number(form.sizeBytes) } }); onSaved();
  }}>
    <div className="form-grid">
      <Field label="版本号"><input required maxLength={50} value={form.version} onChange={(e) => set('version', e.target.value)} /></Field>
      <Field label="平台"><select value={form.platform} onChange={(e) => set('platform', e.target.value)}><option value="win32-x64">Windows 64 位</option></select></Field>
      <Field label="安装包下载地址" wide><input type="url" required value={form.downloadUrl} onChange={(e) => set('downloadUrl', e.target.value)} /></Field>
      <Field label="SHA-256 校验值" wide><input required pattern="[a-fA-F0-9]{64}" minLength={64} maxLength={64} value={form.sha256} onChange={(e) => set('sha256', e.target.value)} /></Field>
      <Field label="安装包大小（字节）"><input type="number" min="1" max={Number.MAX_SAFE_INTEGER} step="1" required value={form.sizeBytes} onChange={(e) => set('sizeBytes', e.target.value)} /></Field>
      <Field label="更新说明" wide><textarea rows={6} required maxLength={10000} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
    </div>
  </Form></Modal>;
}

export function ReleasesPage() {
  const resource = useResource('/admin/releases');
  const [create, setCreate] = useState(false);
  const [selected, setSelected] = useState(null);
  return <><Toolbar resource={resource}><h2>版本发布记录</h2><Button icon={Plus} className="primary" onClick={() => setCreate(true)}>发布版本</Button></Toolbar>
    <Resource resource={resource}>{({ releases }) => <Table rows={releases} emptyTitle="尚未发布客户端版本" emptyDetail="发布版本后，这里将显示安装包与更新说明。" columns={[
      { key: 'version', label: '版本', render: (row) => <button className="text-link" onClick={() => setSelected(row)}>{row.version}</button> },
      { key: 'platform', label: '平台', render: (row) => row.platform === 'win32-x64' ? 'Windows 64 位' : row.platform },
      { key: 'sizeBytes', label: '安装包大小', render: (row) => `${(row.sizeBytes / 1024 / 1024).toFixed(2)} MB` },
      { key: 'createdAt', label: '发布时间', render: (row) => date(row.createdAt) },
      { key: 'actions', label: '操作', render: (row) => <Button className="subtle" onClick={() => setSelected(row)}>查看详情</Button> },
    ]} />}</Resource>
    {create && <ReleaseEditor onClose={() => setCreate(false)} onSaved={() => { setCreate(false); resource.refresh(); }} />}
    {selected && <Modal title={`版本 ${selected.version}`} onClose={() => setSelected(null)} wide>
      <dl className="release-details"><dt>发布时间</dt><dd>{date(selected.createdAt)}</dd><dt>SHA-256</dt><dd className="mono">{selected.sha256}</dd><dt>更新说明</dt><dd className="release-notes">{selected.notes}</dd></dl>
      {/^https:\/\//i.test(selected.downloadUrl) ? <a className="button primary" href={selected.downloadUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} />下载安装包</a> : <Alert>此安装包地址不可用。</Alert>}
    </Modal>}
  </>;
}
