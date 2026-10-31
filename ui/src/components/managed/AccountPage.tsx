import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, LogOut, MessageSquare, RefreshCw, Ticket, Monitor, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useManaged } from './ManagedContext';
import './account.css';

type Row = Record<string, any>;
const numeric = (value: unknown) => (typeof value === 'number' || (typeof value === 'string' && value.trim()))
  && Number.isFinite(Number(value)) ? Number(value) : null;
const money = (value: unknown, scale = 1e6) => numeric(value) === null ? '—'
  : (Number(value) / scale).toLocaleString('zh-CN', { maximumFractionDigits: 12, minimumFractionDigits: 2 });
const rows = (value: any): Row[] => Array.isArray(value) ? value : value?.items || value?.devices || value?.ledger || value?.entries || value?.models || [];
const preciseAmount = (item: Row) => item.amountUnits != null
  ? money(item.amountUnits, 1e12)
  : money(item.amountMicros ?? item.amount_micros);
const date = (value: unknown) => value ? new Date(value as string | number).toLocaleString('zh-CN') : '—';
const labels: Record<string, string> = {
  usage: '模型消费', gift: '注册赠送', redemption: '兑换充值', adjustment: '人工调整', release: '释放预留',
  completed: '已完成', cancelled: '已取消', pending: '待核查', released: '已释放',
};
const errorLabels: Record<string, string> = {
  CODE_UNAVAILABLE: '兑换码无效、已使用或已过期，请核对后重试。',
  REDEMPTION_RATE_LIMIT: '兑换尝试过于频繁，请稍后再试。',
  INSUFFICIENT_BALANCE: '可用余额不足，请兑换充值后重试。',
  ACCOUNT_DISABLED: '账户暂不可用，请联系管理员。',
  APP_FORBIDDEN: '当前账户没有此服务的使用权限，请联系管理员。',
  INVALID_PASSWORD: '密码校验失败，请检查当前密码，并确认新密码至少 12 位且不超过 72 字节。',
  INVALID_CREDENTIALS: '身份验证失败，请检查密码或重新登录。',
  WEAK_PASSWORD: '新密码不符合要求，请使用至少 12 位密码。',
};
function chineseError(error: unknown) {
  return error instanceof Error && /[\u3400-\u9fff]/.test(error.message)
    ? error.message : '操作失败，请稍后重试。';
}
async function accountApi(endpoint: string, body?: unknown, method = body ? 'POST' : 'GET', signal?: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(`/api/managed${endpoint}`, {
      method, headers: { 'Content-Type': 'application/json' },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error('网络连接失败或请求超时，请检查连接后重试。');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const fallback = response.status === 401 ? '登录已失效，请重新登录。'
      : response.status === 403 ? '当前账户没有此服务的使用权限，请联系管理员。'
        : response.status === 429 ? '操作过于频繁，请稍后再试。'
          : response.status === 400 ? '提交的信息不符合要求，请检查后重试。'
            : '服务暂不可用，请稍后重试。';
    throw new Error(errorLabels[data?.code] || fallback);
  }
  if (!data || typeof data !== 'object') throw new Error('服务返回的数据不完整，请刷新重试。');
  return data;
}

type ResourceKey = 'user' | 'wallet' | 'ledger' | 'devices' | 'models';
type Resource = { data: Row | null; loading: boolean; error: string };
const endpoints: Record<ResourceKey, string> = {
  user: '/me', wallet: '/wallet', ledger: '/ledger', devices: '/devices', models: '/models',
};
const pending: Resource = { data: null, loading: true, error: '' };
function ResourceMessage({ resource, label }: { resource: Resource; label: string }) {
  if (resource.error) return <p className="account-error" role="alert">{label}读取失败：{resource.error}</p>;
  if (resource.loading) return <p role="status">{label}读取中…</p>;
  return null;
}

export default function AccountPage({ modelsOnly = false }: { modelsOnly?: boolean }) {
  const managed = useManaged();
  const navigate = useNavigate();
  const [resources, setResources] = useState<Record<ResourceKey, Resource>>({
    user: pending, wallet: pending, ledger: pending, devices: pending, models: pending,
  });
  const activeRequest = useRef<AbortController>();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const refresh = useCallback(async (keys: ResourceKey[] = modelsOnly ? ['models'] : ['user', 'wallet', 'ledger', 'devices', 'models']) => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setResources(previous => {
      const next = { ...previous };
      for (const key of keys) next[key] = { ...previous[key], loading: true, error: '' };
      return next;
    });
    // Each result commits independently; a slow or failed ledger must not hide the wallet.
    const results = await Promise.all(keys.map(async key => {
      try {
        const data = await accountApi(endpoints[key], undefined, 'GET', controller.signal);
        if (controller.signal.aborted) return [key, false] as const;
        setResources(previous => ({ ...previous, [key]: { data, loading: false, error: '' } }));
        return [key, true] as const;
      } catch (err) {
        if (!controller.signal.aborted) {
          setResources(previous => ({ ...previous, [key]: { data: null, loading: false, error: chineseError(err) } }));
        }
        return [key, false] as const;
      }
    }));
    return Object.fromEntries(results) as Partial<Record<ResourceKey, boolean>>;
  }, [modelsOnly]);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (err) { setError(chineseError(err)); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    setError(''); setNotice('');
    if (managed) void refresh();
    return () => activeRequest.current?.abort();
  }, [managed, refresh]);
  const user = resources.user.data?.user || resources.user.data;
  const wallet = resources.wallet.data;
  const ledger = rows(resources.ledger.data);
  const devices = rows(resources.devices.data);
  const models = rows(resources.models.data);
  const refreshing = (modelsOnly ? [resources.models] : Object.values(resources)).some(resource => resource.loading);
  const disabled = busy || refreshing;
  const available = numeric(wallet?.availableUnits) ?? numeric(wallet?.availableMicros ?? wallet?.balanceMicros);
  const insufficient = !modelsOnly && !resources.wallet.loading && !resources.wallet.error && available !== null && available <= 0;
  const modelUnavailable = resources.models.loading || !!resources.models.error || models.length === 0;
  const balanceText = (value: unknown, units?: unknown) => {
    if (resources.wallet.loading) return '读取中…';
    if (resources.wallet.error) return '暂不可用';
    const formatted = numeric(units) === null ? money(value) : money(units, 1e12);
    return formatted === '—' ? formatted : `¥ ${formatted}`;
  };
  if (!managed) return <div className="managed-account"><h1>账户</h1><p>当前使用本机模式。</p></div>;
  return (
    <main className="managed-account">
      <header>
        {!modelsOnly && <button title="返回工作区" aria-label="返回工作区" onClick={() => navigate('/')}><ArrowLeft size={18} /></button>}
        <div><h1>{modelsOnly ? '可用模型' : '我的账户'}</h1>{!modelsOnly && <>
          {user?.email && <p>{user.email}</p>}
          <ResourceMessage resource={resources.user} label="账户信息" />
        </>}</div>
        <button title="刷新" aria-label="刷新" disabled={disabled} onClick={() => void run(async () => {
          let authorized = true;
          try {
            await accountApi('/refresh-models', {});
          } catch (err) {
            authorized = false;
            setError(`模型授权刷新失败：${chineseError(err)}`);
          }
          const results = await refresh();
          setNotice(authorized && Object.values(results).every(Boolean)
            ? `刷新成功，${modelsOnly ? '可用模型' : '账户信息'}已更新。`
            : '部分数据未能更新，请查看各区域提示。');
        })}><RefreshCw size={18} /></button>
        {!modelsOnly && window.pilotdeckDesktop?.managedLogout && <button disabled={busy} onClick={() => void run(async () => { await window.pilotdeckDesktop!.managedLogout!(); })}><LogOut size={16} />退出登录</button>}
      </header>
      {error && <p className="account-error" role="alert">{error}</p>}
      {notice && <p className="account-notice" role="status">{notice}</p>}
      <nav className="account-actions" aria-label="开始使用">
        <button disabled={modelUnavailable || insufficient} onClick={() => {
          navigate('/');
          // The shell also needs to leave any remembered Files or Dashboard tab.
          window.dispatchEvent(new CustomEvent('pilotdeck:notification-navigate', { detail: {} }));
        }}><MessageSquare size={16} />开始对话</button>
        <button onClick={() => navigate('/education')}><BookOpen size={16} />进入学习</button>
      </nav>
      {insufficient && <p className="account-warning" role="status">可用余额不足，请兑换充值后再开始对话。</p>}
      {!modelsOnly && <>
        <section aria-label="账户余额" aria-busy={resources.wallet.loading}>
          <div className="account-balances">
            <div><span><Wallet size={16} />可用余额</span><strong>{balanceText(wallet?.availableMicros ?? wallet?.balanceMicros, wallet?.availableUnits)}</strong></div>
            <div><span>预留金额</span><strong>{balanceText(wallet?.heldMicros ?? wallet?.reservedMicros, wallet?.heldUnits)}</strong></div>
            <div><span>赠送余额</span><strong>{balanceText(wallet?.giftMicros)}</strong></div>
            <div><span>充值余额</span><strong>{balanceText(wallet?.rechargeMicros ?? wallet?.purchasedMicros)}</strong></div>
          </div>
          <ResourceMessage resource={resources.wallet} label="余额" />
        </section>
        <form className="account-inline" onSubmit={event => {
          event.preventDefault();
          if (disabled || !code.trim()) return;
          void run(async () => {
            await accountApi('/redeem', { code: code.trim() });
            setCode('');
            setNotice('兑换成功，正在更新余额。');
            const results = await refresh(['wallet', 'ledger']);
            setNotice(results.wallet ? '兑换成功，余额已更新。' : '兑换成功，余额暂未更新，请点击刷新重试。');
          });
        }}>
          <label htmlFor="redeem-code">兑换码</label>
          <input id="redeem-code" value={code} onChange={event => setCode(event.target.value)} required autoComplete="off" maxLength={128} />
          <button disabled={disabled || !code.trim()} type="submit"><Ticket size={16} />兑换</button>
        </form>
      </>}
      <section><h2>模型价格 <small>元 / 百万 Token</small></h2>
        <ResourceMessage resource={resources.models} label="模型" />
        <div className="account-table"><table><thead><tr><th>模型</th><th>输入</th><th>输出</th></tr></thead>
          <tbody>{models.map(model => <tr key={model.id}><td>{model.name || model.id}</td><td>{money(model.inputPriceMicros)}</td><td>{money(model.outputPriceMicros)}</td></tr>)}</tbody></table>
          {!resources.models.loading && !resources.models.error && !models.length && <p>暂未开放对话模型，请联系管理员。</p>}
        </div>
      </section>
      {!modelsOnly && <>
        <section><h2>账单</h2><ResourceMessage resource={resources.ledger} label="账单" /><div className="account-table"><table>
          <thead><tr><th>时间</th><th>类型</th><th>金额（元）</th><th>模型 / Token 用量</th><th>状态 / 说明</th></tr></thead>
          <tbody>{ledger.map((item, i) => <tr key={item.id || i}>
            <td>{date(item.createdAt ?? item.created_at)}</td><td>{labels[item.kind] || item.kind || item.type}</td><td>{preciseAmount(item)}</td>
            <td>{item.call ? <><div>{item.call.modelId}</div><div>输入 {item.call.inputTokens ?? '待核查'} / 输出 {item.call.outputTokens ?? '待核查'}</div>
              <small>当次单价：输入 ¥{money(item.call.inputPriceMicros)} / 输出 ¥{money(item.call.outputPriceMicros)} 每百万 Token</small></> : '—'}</td>
            <td>{labels[item.call?.status] || item.reason || item.status || '已完成'}</td>
          </tr>)}</tbody>
        </table>{!resources.ledger.loading && !resources.ledger.error && !ledger.length && <p>暂无账单。</p>}</div></section>
        <section><h2>登录设备</h2><ResourceMessage resource={resources.devices} label="登录设备" /><ul className="account-devices">
          {devices.map(device => <li key={device.id}><Monitor size={18} /><div><strong>{device.deviceName || device.device_name}</strong><p>{date(device.lastSeenAt ?? device.last_seen_at)}</p></div>
            <button disabled={disabled} onClick={() => void run(async () => {
              await accountApi(`/devices/${encodeURIComponent(device.id)}`, {}, 'DELETE');
              if (device.current && window.pilotdeckDesktop?.managedLogout) await window.pilotdeckDesktop.managedLogout();
              else {
                await refresh(['devices']);
                setNotice('设备已退出。');
              }
            })}>{device.current ? '退出当前设备' : '退出设备'}</button></li>)}
        </ul>{!resources.devices.loading && !resources.devices.error && !devices.length && <p>暂无登录设备。</p>}</section>
        <section><h2>修改密码</h2><form className="account-password" onSubmit={event => {
          event.preventDefault(); void run(async () => {
            await accountApi('/auth/change-password', { currentPassword: password, newPassword });
            setPassword(''); setNewPassword(''); setNotice('密码已修改，请重新登录。');
            await window.pilotdeckDesktop?.managedLogout?.();
          });
        }}>
          <label>当前密码<input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" /></label>
          <label>新密码<input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={12} autoComplete="new-password" /></label>
          <button disabled={busy} type="submit">修改密码</button>
        </form></section>
      </>}
    </main>
  );
}
