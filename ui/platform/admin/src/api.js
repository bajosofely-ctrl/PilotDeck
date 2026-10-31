const TOKEN_KEY = 'pilotdeck.admin.token';
const DEVICE_KEY = 'pilotdeck.admin.device';

export const session = {
  get: () => sessionStorage.getItem(TOKEN_KEY),
  set: (token) => sessionStorage.setItem(TOKEN_KEY, token),
  clear: () => sessionStorage.removeItem(TOKEN_KEY),
};

export function deviceIdentity() {
  let deviceId = localStorage.getItem(DEVICE_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, deviceId);
  }
  return { deviceId, deviceName: 'PilotDeck 管理后台 · 浏览器' };
}

export async function api(path, { method = 'GET', body, signal, token = session.get() } = {}) {
  let response;
  try {
    response = await fetch(`/api/platform${path}`, {
      method, signal,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('无法连接服务，请检查网络后重试。');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && token && token === session.get()) {
      session.clear();
      window.dispatchEvent(new Event('admin-session-expired'));
    }
    const error = new Error(data?.error || `请求失败（${response.status}），请稍后重试。`);
    error.status = response.status;
    throw error;
  }
  if (data === null) throw new Error('服务返回了无效数据，请稍后重试。');
  return data;
}

export function toMicros(value) {
  const text = String(value).trim();
  if (!/^-?\d+(?:\.\d{1,6})?$/.test(text)) throw new Error('金额最多支持 6 位小数。');
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace(/^-/, '').split('.');
  const amount = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('金额超出支持范围。');
  return Number(negative ? -amount : amount);
}

export function fromMicros(value) {
  if (value === undefined || value === null) return '';
  return (Number(value) / 1000000).toFixed(6).replace(/\.?0+$/, '') || '0';
}

export function money(value) {
  if (value === undefined || value === null) return '—';
  return `¥${new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 12 }).format(Number(value) / 1000000)}`;
}

export function date(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN', { hour12: false });
}

export const pathId = (id) => encodeURIComponent(id);

export function exportCsv(filename, columns, rows) {
  const cell = (value) => {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const csv = '\uFEFF' + [columns.map(([label]) => label), ...rows.map((row) => columns.map(([, key]) => row[key]))]
    .map((row) => row.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
