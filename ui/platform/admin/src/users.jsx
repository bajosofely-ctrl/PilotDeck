import React, { useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, KeyRound, Plus, Search, UserRound, Wallet } from 'lucide-react';
import { api, date, money, pathId, toMicros } from './api.js';
import { Action, Button, Field, Form, Modal, Resource, Selection, Status, Table, Toolbar, useResource } from './components.jsx';
import { LedgerTable } from './operations.jsx';

export const appNames = { chat: '聊天', automation: '自动化', skills: '技能', learning: '学习', projects: '项目', files: '文件', terminal: '终端', computer: '电脑操作', plugins: '插件', mcp: 'MCP' };
export const namedApps = (apps) => apps.map((app) => ({ ...app, name: appNames[app.id] || app.name }));

function UserForm({ user, apps, defaults, onSaved, onCancel }) {
  const [email, setEmail] = useState(user?.email || '');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState(user?.status || 'active');
  const [deviceLimit, setDeviceLimit] = useState(user?.deviceLimit ?? defaults.deviceLimit);
  const [concurrencyLimit, setConcurrencyLimit] = useState(user?.concurrencyLimit ?? defaults.concurrencyLimit);
  const [permissions, setPermissions] = useState(user?.apps || defaults.defaultApps || []);
  return <Form onCancel={onCancel} onSubmit={async () => {
    const body = { deviceLimit: Number(deviceLimit), concurrencyLimit: Number(concurrencyLimit), apps: permissions };
    if (user) body.status = status;
    else Object.assign(body, { email, password });
    await api(`/admin/users${user ? `/${pathId(user.id)}` : ''}`, { method: user ? 'PATCH' : 'POST', body });
    onSaved();
  }}>
    <div className="form-grid">
      <Field label="邮箱" wide><input type="email" required value={email} disabled={Boolean(user)} autoComplete="off" onChange={(e) => setEmail(e.target.value)} /></Field>
      {!user && <Field label="初始密码（至少 12 个字符）" wide><input type="password" required minLength={12} maxLength={72} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>}
      {user && <Field label="账号状态" wide><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="active">正常</option><option value="disabled">停用</option></select></Field>}
      <Field label="设备上限"><input type="number" min="1" max="100" required value={deviceLimit} onChange={(e) => setDeviceLimit(e.target.value)} /></Field>
      <Field label="请求并发上限"><input type="number" min="1" max="100" required value={concurrencyLimit} onChange={(e) => setConcurrencyLimit(e.target.value)} /></Field>
    </div>
    <div className="form-section"><h3>应用权限</h3><Selection options={namedApps(apps)} value={permissions} onChange={setPermissions} /></div>
  </Form>;
}

function UserEditor({ user, onClose, onSaved }) {
  const apps = useResource('/admin/apps');
  const settings = useResource('/admin/settings');
  return <Modal title={user ? '编辑用户' : '创建用户'} onClose={onClose}>
    <Resource resource={apps}>{(appData) => <Resource resource={settings}>{(settingData) =>
      <UserForm user={user} apps={appData.apps} defaults={settingData.settings} onCancel={onClose} onSaved={onSaved} />
    }</Resource>}</Resource>
  </Modal>;
}

function Adjustment({ user, onClose, onSaved }) {
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState('add');
  const [reason, setReason] = useState('');
  const [attempt, setAttempt] = useState(null);
  return <Modal title="人工余额调整" onClose={onClose}>
    <p className="description">{user.email}</p>
    <Form submitLabel={attempt ? '重试此笔调整' : '确认调整'} onCancel={onClose} onSubmit={async () => {
      const absolute = toMicros(amount);
      if (absolute <= 0) throw new Error('调整金额必须大于零。');
      // Keep the original payload and id after an ambiguous network failure.
      const body = attempt || { amountMicros: absolute * (direction === 'subtract' ? -1 : 1), reason: reason.trim(), requestId: crypto.randomUUID() };
      if (!body.reason) throw new Error('请填写调整原因。');
      setAttempt(body);
      try {
        await api(`/admin/users/${pathId(user.id)}/adjustments`, { method: 'POST', body });
      } catch (error) {
        if (error.status && error.status < 500) setAttempt(null);
        throw error;
      }
      onSaved(); onClose();
    }}>
      <fieldset disabled={Boolean(attempt)} className="form-fields">
        <Field label="调整方向"><select value={direction} onChange={(e) => setDirection(e.target.value)}><option value="add">增加余额</option><option value="subtract">减少余额</option></select></Field>
        <Field label="金额（元）"><input type="number" min="0.000001" step="0.000001" required value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="调整原因 / 关联流水"><textarea required maxLength={500} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </fieldset>
    </Form>
  </Modal>;
}

function Devices({ userId }) {
  const resource = useResource(`/admin/users/${pathId(userId)}/devices`);
  const [target, setTarget] = useState(null);
  return <>
    <Toolbar resource={resource}><h3>登录设备</h3><Button disabled={!resource.data?.devices?.length} onClick={() => setTarget({ all: true })}>全部下线</Button></Toolbar>
    <Resource resource={resource}>{({ devices }) => <Table rows={devices} emptyTitle="暂无登录设备" emptyDetail="该用户当前没有有效的设备会话。" columns={[
      { key: 'deviceName', label: '设备', render: (row) => <div className="cell-stack"><strong>{row.deviceName || '未命名设备'}</strong><small>{row.deviceId}</small></div> },
      { key: 'createdAt', label: '登录时间', render: (row) => date(row.createdAt) },
      { key: 'lastSeenAt', label: '最近活动', render: (row) => date(row.lastSeenAt) },
      { key: 'action', label: '操作', render: (row) => <Button className="danger subtle" onClick={() => setTarget(row)}>强制下线</Button> },
    ]} />}</Resource>
    {target && <Action title={target.all ? '撤销全部登录设备' : '撤销设备登录'} description={target.all ? '该用户所有设备将需要重新登录。' : `设备「${target.deviceName || target.deviceId}」将需要重新登录。`}
      onClose={() => setTarget(null)} onConfirm={async () => {
        await api(`/admin/users/${pathId(userId)}/devices${target.all ? '' : `/${pathId(target.id)}`}`, { method: 'DELETE' }); resource.refresh();
      }} />}
  </>;
}

function UserWallet({ userId, revision }) {
  const resource = useResource(`/admin/users/${pathId(userId)}/wallet?revision=${revision}`);
  return <Resource resource={resource}>{(wallet) => <div className="balance-strip">
    <div><span>可用余额</span><strong>{money(wallet.availableMicros)}</strong></div>
    <div><span>充值余额</span><strong>{money(wallet.rechargeMicros)}</strong></div>
    <div><span>赠送余额</span><strong>{money(wallet.giftMicros)}</strong></div>
    <div><span>预留金额</span><strong>{money(wallet.heldMicros)}</strong></div>
    <div><span>调整余额</span><strong>{money(wallet.adjustmentMicros)}</strong></div>
    <div><span>已过期余额</span><strong>{money(wallet.expiredMicros)}</strong></div>
  </div>}</Resource>;
}

function UserHistory({ userId, revision }) {
  const resource = useResource(`/admin/ledger?userId=${pathId(userId)}&limit=500&revision=${revision}`);
  return <><Toolbar resource={resource}><h3>最近 500 条资金记录</h3></Toolbar><Resource resource={resource}>{(data) => <LedgerTable rows={data.ledger} />}</Resource></>;
}

function UserDetail({ id, onBack }) {
  const resource = useResource(`/admin/users/${pathId(id)}`);
  const [tab, setTab] = useState('overview');
  const [editor, setEditor] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const [reset, setReset] = useState(false);
  const [password, setPassword] = useState('');
  const [revision, setRevision] = useState(0);
  return <><Button icon={ArrowLeft} className="subtle back-button" onClick={onBack}>返回用户列表</Button>
    <Resource resource={resource}>{({ user }) => <>
      <div className="detail-heading"><div className="detail-identity"><span className="detail-avatar"><UserRound size={24} /></span><div><h2>{user.email}</h2><span className="muted">{user.id}</span></div></div>
        <div className="actions"><Status value={user.status} /><Status value={user.role} />
          {user.role !== 'admin' && <><Button icon={KeyRound} onClick={() => { setPassword(''); setReset(true); }}>重置密码</Button><Button onClick={() => setEditor(true)}>编辑用户</Button><Button icon={Wallet} className="primary" onClick={() => setAdjust(true)}>调整余额</Button></>}
        </div></div>
      <div className="tabs" role="tablist" aria-label="用户详情">
        {[['overview', '账号概览'], ['devices', '登录设备'], ['ledger', '账单与记录']].map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>)}
      </div>
      {tab === 'overview' && <>
        <UserWallet userId={id} revision={revision} />
        <dl className="details-grid"><div><dt>注册时间</dt><dd>{date(user.createdAt)}</dd></div><div><dt>设备上限</dt><dd>{user.deviceLimit} 台</dd></div><div><dt>请求并发上限</dt><dd>{user.concurrencyLimit} 条</dd></div><div><dt>应用权限</dt><dd>{user.apps.map((app) => appNames[app] || app).join('、') || '无应用权限'}</dd></div></dl>
      </>}
      {tab === 'devices' && <Devices userId={id} />}
      {tab === 'ledger' && <UserHistory userId={id} revision={revision} />}
      {editor && <UserEditor user={user} onClose={() => setEditor(false)} onSaved={() => { setEditor(false); resource.refresh(); }} />}
      {adjust && <Adjustment user={user} onClose={() => setAdjust(false)} onSaved={() => setRevision((r) => r + 1)} />}
      {reset && <Action title="重置用户密码" description="保存新密码后，该用户的所有登录会话将被撤销。" onClose={() => setReset(false)}
        onConfirm={() => api(`/admin/users/${pathId(id)}/reset-password`, { method: 'POST', body: { newPassword: password } })}>
        <Field label="新密码（至少 12 个字符）"><input type="password" autoComplete="new-password" minLength={12} maxLength={72} required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      </Action>}
    </>}</Resource>
  </>;
}

export function UsersPage() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState(null);
  const [create, setCreate] = useState(false);
  const resource = useResource(`/admin/users?q=${encodeURIComponent(query)}&limit=25&offset=${offset}`);
  if (selected) return <UserDetail id={selected} onBack={() => { setSelected(null); resource.refresh(); }} />;
  return <>
    <Toolbar resource={resource}><form className="search" onSubmit={(e) => { e.preventDefault(); setOffset(0); setQuery(search.trim()); }}><Search size={17} /><input aria-label="搜索用户邮箱" placeholder="搜索邮箱" value={search} onChange={(e) => setSearch(e.target.value)} /><Button type="submit">查询</Button></form>
      <Button icon={Plus} className="primary" onClick={() => setCreate(true)}>创建用户</Button></Toolbar>
    <Resource resource={resource}>{({ users, total }) => <>
      <Table rows={users} emptyTitle={query ? '未找到匹配用户' : '暂无用户'} emptyDetail={query ? '请调整邮箱搜索条件。' : '创建用户后，账号与权限记录将显示在这里。'} columns={[
        { key: 'email', label: '用户', render: (row) => <button className="text-link" onClick={() => setSelected(row.id)}>{row.email}</button> },
        { key: 'role', label: '角色', render: (row) => <Status value={row.role} /> },
        { key: 'status', label: '状态', render: (row) => <Status value={row.status} /> },
        { key: 'deviceLimit', label: '设备上限', render: (row) => `${row.deviceLimit} 台` },
        { key: 'concurrencyLimit', label: '并发上限', render: (row) => `${row.concurrencyLimit} 条` },
        { key: 'createdAt', label: '注册时间', render: (row) => date(row.createdAt) },
        { key: 'action', label: '操作', render: (row) => <Button className="subtle" onClick={() => setSelected(row.id)}>详情</Button> },
      ]} />
      <div className="pagination"><span>共 {total} 个用户</span><Button icon={ChevronLeft} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>上一页</Button><span>{Math.floor(offset / 25) + 1}</span><Button icon={ChevronRight} disabled={offset + 25 >= total} onClick={() => setOffset(offset + 25)}>下一页</Button></div>
    </>}</Resource>
    {create && <UserEditor onClose={() => setCreate(false)} onSaved={() => { setCreate(false); resource.refresh(); }} />}
  </>;
}
