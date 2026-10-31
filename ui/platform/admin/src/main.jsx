import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Blocks, BookOpen, Box, CreditCard, LogOut, Mail, Menu, Settings2, ShieldCheck, Ticket, Users, X } from 'lucide-react';
import { api, deviceIdentity, session } from './api.js';
import { Alert, Button, Field, Form, IconButton } from './components.jsx';
import { UsersPage } from './users.jsx';
import { AppsPage, ModelsPage, SettingsPage } from './configuration.jsx';
import { CodesPage, LedgerPage, ReleasesPage } from './operations.jsx';
import { MailPage } from './mail.jsx';
import './styles.css';

const tabs = [
  { id: 'users', label: '用户管理', icon: Users, component: UsersPage, subtitle: '账号、应用权限与登录设备' },
  { id: 'models', label: '模型与价格', icon: Box, component: ModelsPage, subtitle: '渠道连接、模型管理与销售价格' },
  { id: 'apps', label: '应用管理', icon: Blocks, component: AppsPage, subtitle: '应用开关、可用模型与默认模型' },
  { id: 'codes', label: '兑换码', icon: Ticket, component: CodesPage, subtitle: '批量生成、发放与兑换记录' },
  { id: 'ledger', label: '账务管理', icon: CreditCard, component: LedgerPage, subtitle: '资金流水与异常待核查请求' },
  { id: 'settings', label: '注册与默认值', icon: Settings2, component: SettingsPage, subtitle: '注册策略、赠送余额与新用户权限' },
  { id: 'mail', label: '邮件设置', icon: Mail, component: MailPage, subtitle: '验证码与密码找回邮件' },
  { id: 'releases', label: '客户端版本', icon: BookOpen, component: ReleasesPage, subtitle: '版本记录、更新说明与安装包' },
];

function Login({ onLogin, message }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return <main className="login-page"><div className="login-brand"><ShieldCheck size={28} /><strong>PilotDeck</strong><span>管理后台</span></div>
    <section className="login-form"><h1>管理员登录</h1><Alert>{message}</Alert>
      <Form submitLabel="登录" onSubmit={async () => {
        const result = await api('/auth/login', { method: 'POST', token: null, body: { email, password, ...deviceIdentity() } });
        if (result.user?.role !== 'admin') {
          await api('/auth/logout', { method: 'POST', token: result.token }).catch(() => {});
          throw new Error('此账号没有管理员权限。');
        }
        if (!result.token) throw new Error('服务未返回有效登录凭证。');
        session.set(result.token); onLogin(result.user);
      }}>
        <Field label="邮箱"><input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="密码"><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      </Form>
    </section><footer>PilotDeck · 运营控制台</footer></main>;
}

function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(Boolean(session.get()));
  const [message, setMessage] = useState('');
  const [authError, setAuthError] = useState('');
  const [authRevision, setAuthRevision] = useState(0);
  const [tab, setTab] = useState(() => tabs.find((t) => t.id === location.hash.slice(1))?.id || 'users');
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  useEffect(() => {
    const expire = () => {
      setUser(null); setChecking(false); setAuthError(''); setLogoutError('');
      setMessage('登录已失效，可能已在其他设备登录，请重新登录。');
    };
    window.addEventListener('admin-session-expired', expire);
    return () => window.removeEventListener('admin-session-expired', expire);
  }, []);
  useEffect(() => {
    if (!session.get()) { setChecking(false); return; }
    let cancelled = false;
    setChecking(true); setAuthError('');
    api('/me').then((result) => {
      if (cancelled) return;
      if (result.user?.role !== 'admin') { session.clear(); setMessage('此账号没有管理员权限。'); }
      else setUser(result.user);
    }).catch((error) => { if (!cancelled && error.status !== 401) setAuthError(error.message); })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [authRevision]);
  useEffect(() => {
    if (!user) return;
    const token = session.get();
    let pending;
    const check = async () => {
      if (pending || !token || session.get() !== token) return;
      const controller = new AbortController();
      pending = controller;
      const timeout = setTimeout(() => controller.abort(), 10000);
      try { await api('/me', { token, signal: controller.signal }); }
      catch { /* Only a confirmed 401 in api() expires the session. */ }
      finally { clearTimeout(timeout); pending = null; }
    };
    const visible = () => { if (document.visibilityState === 'visible') void check(); };
    const interval = setInterval(check, 15000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(interval); pending?.abort();
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [user]);
  useEffect(() => {
    const change = () => { setTab(tabs.find((t) => t.id === location.hash.slice(1))?.id || 'users'); setMenuOpen(false); };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  if (checking) return <div className="loading full" role="status">正在验证登录状态…</div>;
  if (authError && !user) return <main className="auth-error"><Alert>{authError}</Alert><Button onClick={() => setAuthRevision((r) => r + 1)}>重新连接</Button><Button onClick={() => { session.clear(); setAuthError(''); }}>返回登录</Button></main>;
  if (!user) return <Login message={message} onLogin={(value) => { setMessage(''); setUser(value); }} />;
  const current = tabs.find((item) => item.id === tab);
  const Page = current.component;
  return <div className="shell">
    {menuOpen && <button aria-label="收起导航" className="nav-backdrop" onClick={() => setMenuOpen(false)} />}
    <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
      <a className="brand" href="#users"><span className="brand-icon"><ShieldCheck size={23} /></span><span><strong>PilotDeck</strong><small>管理后台</small></span></a>
      <div className="nav-label">运营工作台</div>
      <nav aria-label="主导航">{tabs.map(({ id, label, icon: Icon }) => <a key={id} href={`#${id}`} aria-current={tab === id ? 'page' : undefined}><Icon size={18} />{label}</a>)}</nav>
      <div className="sidebar-bottom"><span className="avatar">{user.email?.[0]?.toUpperCase() || 'A'}</span><div><strong>管理员</strong><span title={user.email}>{user.email}</span></div>
        <IconButton label="退出登录" icon={LogOut} disabled={logoutBusy} onClick={async () => {
          setLogoutBusy(true); setLogoutError('');
          try { await api('/auth/logout', { method: 'POST' }); session.clear(); setUser(null); }
          catch (error) { setLogoutError(error.message); }
          finally { setLogoutBusy(false); }
        }} /></div>
    </aside>
    <div className="main"><header className="page-header"><IconButton label={menuOpen ? '收起导航' : '展开导航'} icon={menuOpen ? X : Menu} className="mobile-menu icon-button" onClick={() => setMenuOpen(!menuOpen)} />
      <div><h1>{current.label}</h1><p>{current.subtitle}</p></div><span className="console-label">运营控制台</span></header>
      <div className="page-content"><Alert>{logoutError}</Alert><Page key={tab} /></div>
    </div>
  </div>;
}

class Boundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="auth-error"><Alert>页面暂时无法显示，请刷新后重试。</Alert><Button onClick={() => location.reload()}>刷新页面</Button></main>;
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(<Boundary><App /></Boundary>);
