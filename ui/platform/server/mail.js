import nodemailer from 'nodemailer';
import { asyncRoute, audit, boolean, httpError, onlyFields, text } from './schema.js';

export function createMailSender(env = process.env, request = fetch) {
  return async ({ email, code, purpose, expiresInMinutes }) => {
    const endpoint = env.PLATFORM_MAIL_URL;
    if (!endpoint || !env.PLATFORM_MAIL_TOKEN || !env.PLATFORM_MAIL_FROM) throw new Error('Email delivery is not configured.');
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Email service must use HTTPS.');
    const response = await request(url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${env.PLATFORM_MAIL_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.PLATFORM_MAIL_FROM, to: [email],
        subject: purpose === 'register' ? 'PilotDeck 注册验证码' : 'PilotDeck 密码重置验证码',
        text: `您的验证码为 ${code}，${expiresInMinutes} 分钟内有效。如非本人操作，请忽略此邮件。`,
      }),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error('Email delivery failed.');
  };
}

const SMTP_KEY = 'mail.smtp';
const defaultSettings = () => ({ enabled: false, senderEmail: '', senderName: 'PilotDeck', authorizationCode: '' });

function mailbox(value) {
  const email = text(value, 'email', 254).toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) {
    throw httpError(400, 'INVALID_EMAIL', '请输入有效的邮箱地址。');
  }
  return email;
}

function deliveryError(error) {
  if (error?.code === 'EAUTH') return httpError(503, 'MAIL_AUTH_FAILED', '邮箱认证失败，请检查发件邮箱、SMTP 服务开关和授权码。');
  if (['ETIMEDOUT', 'ECONNECTION', 'ECONNREFUSED', 'ENOTFOUND', 'EDNS', 'ESOCKET'].includes(error?.code)) {
    return httpError(503, 'MAIL_CONNECTION_FAILED', '无法连接邮件服务器，请稍后重试。');
  }
  return httpError(503, 'MAIL_UNAVAILABLE', '邮件发送失败，请检查邮箱设置和收件地址后重试。');
}

export function createMailService({ db, seal, unseal, env = process.env, createTransport = nodemailer.createTransport, request = fetch }) {
  const read = () => {
    const row = db.prepare('SELECT value FROM platform_meta WHERE key=?').get(SMTP_KEY);
    return row ? JSON.parse(unseal(row.value)) : null;
  };
  const publicSettings = () => {
    const { enabled, senderEmail, senderName, authorizationCode } = read() || defaultSettings();
    return { provider: 'qq', enabled, senderEmail, senderName, hasAuthorizationCode: Boolean(authorizationCode) };
  };
  const save = (body, actor) => {
    onlyFields(body, ['enabled', 'senderEmail', 'senderName', 'authorizationCode']);
    const previous = read() || defaultSettings();
    const enabled = boolean(body.enabled, 'enabled');
    const senderEmail = body.senderEmail === '' && !enabled ? '' : mailbox(body.senderEmail);
    if (senderEmail && !/@(?:qq|foxmail)\.com$/.test(senderEmail)) {
      throw httpError(400, 'INVALID_SENDER', '请填写 QQ 邮箱或 Foxmail 邮箱地址。');
    }
    const senderName = text(body.senderName, 'sender name', 80);
    let authorizationCode = senderEmail === previous.senderEmail ? previous.authorizationCode : '';
    if (body.authorizationCode !== undefined && body.authorizationCode !== '') {
      if (typeof body.authorizationCode !== 'string' || !/^[a-zA-Z0-9]{16}$/.test(body.authorizationCode.trim())) {
        throw httpError(400, 'INVALID_MAIL_SECRET', '请填写 16 位邮箱授权码，不是邮箱登录密码。');
      }
      authorizationCode = body.authorizationCode.trim();
    }
    if (enabled && (!senderEmail || !authorizationCode)) {
      throw httpError(400, 'MAIL_NOT_CONFIGURED', '请填写发件邮箱和授权码；更换邮箱时需要重新填写授权码。');
    }
    const value = seal(JSON.stringify({ enabled, senderEmail, senderName, authorizationCode }));
    db.transaction(() => {
      db.prepare('INSERT INTO platform_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
        .run(SMTP_KEY, value);
      audit(db, actor, 'mail.update');
    })();
    return publicSettings();
  };
  const sendSmtp = async (settings, email, content) => {
    if (!settings?.senderEmail || !settings.authorizationCode) throw httpError(503, 'MAIL_NOT_CONFIGURED', '请先保存发件邮箱和授权码。');
    const recipient = mailbox(email);
    let transport;
    try {
      transport = createTransport({
        host: 'smtp.qq.com', port: 465, secure: true, pool: false,
        auth: { user: settings.senderEmail, pass: settings.authorizationCode },
        tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
        connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
        logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
      });
      const result = await transport.sendMail({
        from: { name: settings.senderName, address: settings.senderEmail }, to: [recipient],
        ...content, disableFileAccess: true, disableUrlAccess: true,
      });
      if (!result?.accepted?.length || result.rejected?.length) throw new Error('Recipient rejected');
    } catch (error) {
      throw deliveryError(error);
    } finally {
      transport?.close();
    }
  };
  const legacy = createMailSender(env, request);
  const sendCode = async message => {
    const settings = read();
    // An explicit SMTP disable must not silently fall back to another sender.
    if (!settings) return legacy(message);
    if (!settings.enabled) throw new Error('Email delivery is disabled.');
    return sendSmtp(settings, message.email, {
      subject: message.purpose === 'register' ? 'PilotDeck 注册验证码' : 'PilotDeck 密码重置验证码',
      text: `您的验证码为 ${message.code}，${message.expiresInMinutes} 分钟内有效。如非本人操作，请忽略此邮件。`,
    });
  };
  const sendTest = email => sendSmtp(read(), email, {
    subject: 'PilotDeck 邮件发送测试',
    text: '这是一封 PilotDeck 后台发送的测试邮件。收到此邮件表示当前发件配置可用。本邮件不包含登录验证码。',
  });
  return { publicSettings, save, sendCode, sendTest };
}

export function mountMail(app, { mail, requireAdmin, db, rateLimit }) {
  const route = (method, endpoint, handler) => app[method](`/api/platform/admin/mail${endpoint}`, requireAdmin, asyncRoute(handler));
  route('get', '', (_req, res) => res.json({ mail: mail.publicSettings() }));
  route('put', '', (req, res) => res.json({ mail: mail.save(req.body, req.platformUser.id) }));
  route('post', '/test', async (req, res) => {
    onlyFields(req.body, ['email']);
    const email = mailbox(req.body.email);
    rateLimit('mail-test-minute', req.platformUser.id, 3, 60000);
    rateLimit('mail-test-hour', req.platformUser.id, 20, 3600000);
    try {
      await mail.sendTest(email);
      audit(db, req.platformUser.id, 'mail.test-success');
      res.json({ ok: true });
    } catch (error) {
      audit(db, req.platformUser.id, 'mail.test-failure');
      throw error;
    }
  });
}
