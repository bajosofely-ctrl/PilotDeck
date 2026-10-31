import { randomBytes } from 'node:crypto';

// Keep these helpers self-contained: their compiled source also runs in the nonce script.
export function managedPasswordError(password: string): string {
  if (password.length < 12) return '密码至少需要 12 个字符。';
  if (new TextEncoder().encode(password).length > 72) return '密码过长，请缩短至 72 个 UTF-8 字节以内；中文和表情会占用多个字节。';
  if (password.includes('\0')) return '密码包含不支持的字符，请重新输入。';
  return '';
}

export function managedLoginError(error: unknown): string {
  // IPC currently returns message strings. Only translate known messages, never echo details.
  switch (error) {
    case 'Invalid email.':
    case 'Invalid email': return '请输入有效的邮箱地址。';
    case 'Invalid password':
    case 'Password must contain at least 12 characters and at most 72 UTF-8 bytes.':
      return '密码至少需要 12 个字符，且不能超过 72 个 UTF-8 字节。';
    case 'Invalid email or password.': return '邮箱或密码不正确，请检查后重试。';
    case 'Invalid code':
    case 'Invalid or expired verification code.': return '验证码不正确或已过期，请检查或重新获取。';
    case 'Too many attempts. Try again later.': return '操作过于频繁，请稍后再试。';
    case 'Device limit reached. Sign out an existing device first.':
      return '登录设备数量已达上限，请先在其他设备退出登录。';
    case 'Registration is disabled.': return '暂未开放注册，请联系服务提供方。';
    case 'Email is already registered.': return '该邮箱已注册，请登录或找回密码。';
    case 'Registration could not be completed.': return '暂时无法完成注册，请尝试登录、找回密码或稍后重试。';
    case 'Verification email could not be sent. Try again later.': return '验证码邮件暂时无法发送，请稍后重试。';
    case 'An active customer account is required. Administrator accounts cannot sign in here.':
      return '请使用已启用的客户账号登录；管理员账号不能登录客户端。';
    case 'Sign in required.':
    case 'Session is no longer valid.':
    case 'Invalid account session':
    case 'Invalid cached account':
    case 'Cached account identity mismatch':
    case 'Cached session expired or invalid. Please sign in online.':
    case 'Secure session storage is unavailable. Please sign in online.':
    case 'Account verification failed (401). Please sign in online.':
    case 'Account verification failed (403). Please sign in online.':
      return '已保存的登录状态不可用，请连接网络并重新登录。';
    case 'Please sign out before signing in to another account.': return '请先退出当前账号，再登录其他账号。';
    case 'PilotDeck is closing.': return '应用正在关闭，请重新打开后登录。';
    case 'fetch failed':
    case 'Failed to fetch':
    case 'NetworkError when attempting to fetch resource.':
    case 'Account service unavailable.': return '暂时无法连接账号服务，请检查网络后重试。';
    case 'The operation was aborted due to timeout':
    case 'The operation was aborted.': return '连接账号服务超时，请稍后重试。';
    default: return '暂时无法完成操作，请稍后重试；如仍有问题，请联系服务提供方。';
  }
}

export function managedLoginDocument(_serviceOrigin: string): string {
  const nonce = randomBytes(18).toString('base64');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; form-action 'none'; base-uri 'none'">
<title>PilotDeck</title><style nonce="${nonce}">
*{box-sizing:border-box}body{margin:0;background:#f6f7fa;color:#20252d;font:15px system-ui,sans-serif}
main{max-width:440px;margin:24px auto;padding:0 24px}h1{font-size:28px;margin:0 0 16px;letter-spacing:0}
nav{display:flex;border-bottom:1px solid #d5dbe4;margin-bottom:18px}
button,input,select{font:inherit}nav button{flex:1;border:0;border-bottom:2px solid transparent;background:none;padding:12px 4px;color:#566171}
nav button[aria-selected=true]{border-color:#176c56;color:#176c56}label{display:block;margin:12px 0 6px}
input{width:100%;height:44px;border:1px solid #bec8d6;border-radius:5px;padding:10px;background:white}
input:focus,button:focus-visible,select:focus{outline:2px solid #176c56;outline-offset:1px}button{cursor:pointer}
button:disabled{cursor:default;opacity:.6}input:disabled,select:disabled{opacity:.7}
.code{display:grid;grid-template-columns:minmax(0,1fr) 126px;gap:10px}
.code button{border:1px solid #bec8d6;background:#fff;padding:0 8px;border-radius:5px}
#password-hint{font-size:12px;line-height:1.5;color:#566171;margin:6px 0 0}
#submit{width:100%;height:44px;background:#176c56;border:0;border-radius:5px;color:#fff;margin-top:20px}
#status{min-height:44px;line-height:1.5;overflow-wrap:anywhere;color:#176c56;margin:12px 0 0}
#status[data-error=true]{color:#a72e38}
#saved{display:flex;gap:10px;margin-top:12px}#saved select{min-width:0;flex:1;padding:8px;border:1px solid #bec8d6;border-radius:5px}
#saved button{flex-shrink:0;background:white;border:1px solid #bec8d6;border-radius:5px;padding:8px} [hidden]{display:none!important}
</style></head><body><main><h1>PilotDeck</h1>
<nav role="tablist" aria-label="账号"><button id="tab-login" type="button" data-mode="login" role="tab" aria-controls="form" aria-selected="true">登录</button><button id="tab-register" type="button" data-mode="register" role="tab" aria-controls="form" aria-selected="false" tabindex="-1">注册</button><button id="tab-reset-password" type="button" data-mode="reset-password" role="tab" aria-controls="form" aria-selected="false" tabindex="-1">找回密码</button></nav>
<form id="form" role="tabpanel" aria-labelledby="tab-login" aria-busy="false" novalidate><label for="email">邮箱</label><input id="email" type="email" autocomplete="username" autocapitalize="none" spellcheck="false" required maxlength="254">
<label for="password" id="password-label">密码</label><input id="password" type="password" autocomplete="current-password" required minlength="12" maxlength="72" aria-describedby="password-hint">
<p id="password-hint">至少 12 个字符，最多 72 字节；中文和表情占多个字节。</p>
<div id="verification" hidden><label for="code">邮箱验证码</label><div class="code"><input id="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6"><button id="send-code" type="button">发送验证码</button></div></div>
<button id="submit" type="submit">登录</button>
<div id="saved" hidden><select id="saved-account" aria-label="已登录账户"></select><button id="resume" type="button">继续登录</button></div>
<p id="status" role="status" aria-live="polite"></p></form>
</main><script nonce="${nonce}">
const byId = id => document.getElementById(id);
const passwordError = ${managedPasswordError.toString()};
const loginError = ${managedLoginError.toString()};
const tabs = Array.from(document.querySelectorAll('[data-mode]'));
const cooldowns = new Map();
let mode = 'login', busy = false, pendingAction = '', opening = false, cooldownTimer;
const emailKey = () => byId('email').value.trim().toLowerCase();
const secondsRemaining = () => Math.max(0, Math.ceil(((cooldowns.get(emailKey()) || 0) - Date.now()) / 1000));
function status(message, isError = false) {
  byId('status').textContent = message;
  byId('status').dataset.error = String(isError);
}
function renderControls() {
  const locked = busy || opening;
  document.querySelectorAll('button,input,select').forEach(control => control.disabled = locked);
  byId('form').setAttribute('aria-busy', String(locked));
  const seconds = secondsRemaining();
  byId('send-code').disabled = locked || seconds > 0 || mode === 'login';
  byId('send-code').textContent = pendingAction === 'code' ? '发送中…' : seconds > 0 ? seconds + ' 秒后重发' : '发送验证码';
  byId('resume').disabled = locked || !byId('saved-account').value;
  byId('resume').textContent = pendingAction === 'resume' ? '正在登录…' : '继续登录';
  const labels = { login: '登录', register: '注册并登录', 'reset-password': '重置密码' };
  const progress = { login: '登录中…', register: '注册中…', 'reset-password': '重置中…' };
  byId('submit').textContent = opening ? '正在打开…' : progress[pendingAction] || labels[mode];
}
function startCooldown(email) {
  // The service charges per email across purposes, even when delivery fails.
  cooldowns.set(email, Date.now() + 60_000);
  if (cooldownTimer === undefined) cooldownTimer = setInterval(() => {
    for (const [key, deadline] of cooldowns) if (deadline <= Date.now()) cooldowns.delete(key);
    renderControls();
    if (!cooldowns.size) { clearInterval(cooldownTimer); cooldownTimer = undefined; }
  }, 1000);
}
function setMode(next) {
  if (busy || opening || !['login', 'register', 'reset-password'].includes(next)) return;
  if (mode !== next) byId('code').value = '';
  mode = next;
  tabs.forEach(button => {
    const selected = button.dataset.mode === mode;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  byId('form').setAttribute('aria-labelledby', 'tab-' + mode);
  byId('verification').hidden = mode === 'login';
  byId('code').required = mode !== 'login';
  byId('password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  byId('password-label').textContent = mode === 'reset-password' ? '新密码' : '密码';
  for (const name of ['email', 'password', 'code']) byId(name).removeAttribute('aria-invalid');
  status('');
  renderControls();
}
tabs.forEach((button, index) => {
  button.addEventListener('click', () => setMode(button.dataset.mode));
  button.addEventListener('keydown', event => {
    if (busy || opening || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    setMode(tabs[next].dataset.mode);
    tabs[next].focus();
  });
});
function invalid(name, message) {
  status(message, true);
  byId(name).setAttribute('aria-invalid', 'true');
  byId(name).focus();
}
async function submit(action) {
  if (busy || opening) return;
  if (action === 'code' && (mode === 'login' || secondsRemaining() > 0)) return;
  if (action === 'resume' && !byId('saved-account').value) return;
  const email = byId('email').value.trim();
  const password = byId('password').value;
  const code = byId('code').value.trim();
  if (action !== 'resume') {
    if (email.length > 254 || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) || byId('email').validity.typeMismatch) {
      invalid('email', '请输入有效的邮箱地址。'); return;
    }
    if (action !== 'code') {
      const message = passwordError(password);
      if (message) { invalid('password', message); return; }
      if (action !== 'login' && !/^[0-9]{6}$/.test(code)) { invalid('code', '请输入邮件中的 6 位数字验证码。'); return; }
    }
  }
  const input = action === 'resume' ? { accountId: byId('saved-account').value }
    : action === 'code' ? { email, purpose: mode }
    : action === 'login' ? { email, password } : { email, password, code };
  busy = true;
  pendingAction = action;
  if (action === 'code') startCooldown(email.toLowerCase());
  renderControls();
  status('');
  let resetComplete = false;
  try {
    const result = await window.pilotdeckManagedLogin.submit(action, input);
    if (result?.ok !== true) { status(loginError(result?.error), true); return; }
    if (action === 'code') status('验证码已发送，请检查邮箱和垃圾邮件；验证码 10 分钟内有效。');
    else if (action === 'reset-password') {
      resetComplete = true;
      byId('password').value = ''; byId('code').value = '';
    } else {
      opening = true;
      byId('password').value = ''; byId('code').value = '';
      status('登录成功，正在打开 PilotDeck…');
    }
  } catch (error) { status(loginError(error?.message), true); }
  finally {
    busy = false; pendingAction = '';
    if (resetComplete) {
      setMode('login');
      status('密码已重置，请使用新密码登录。');
      byId('password').focus();
    }
    renderControls();
  }
}
byId('form').addEventListener('submit', event => { event.preventDefault(); void submit(mode); });
byId('send-code').addEventListener('click', () => { void submit('code'); });
byId('resume').addEventListener('click', () => { void submit('resume'); });
for (const name of ['email', 'password', 'code']) byId(name).addEventListener('input', () => {
  byId(name).removeAttribute('aria-invalid');
  if (!busy && !opening) status('');
  renderControls();
});
setMode('login');
window.pilotdeckManagedLogin.savedAccounts().then(accounts => {
  for (const account of accounts) {
    const option = document.createElement('option');
    option.value = account.id; option.textContent = account.email;
    byId('saved-account').appendChild(option);
  }
  byId('saved').hidden = accounts.length === 0;
  renderControls();
}).catch(() => {});
</script></body></html>`;
}
