// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import AccountPage from './AccountPage';

const state = vi.hoisted(() => ({ managed: true }));
vi.mock('./ManagedContext', () => ({ useManaged: () => state.managed }));
vi.unmock('lucide-react');
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete window.pilotdeckDesktop;
  state.managed = true;
});

function fixture({ modelsOnly = false, responses = {} }: {
  modelsOnly?: boolean;
  responses?: Record<string, () => Promise<Response>>;
} = {}) {
  const logout = vi.fn(async () => {});
  Object.defineProperty(window, 'pilotdeckDesktop', { configurable: true, value: { managedLogout: logout } });
  const request = vi.fn(async (url: string, options?: RequestInit) => {
    const endpoint = url.replace('/api/managed', '');
    if (responses[endpoint]) return responses[endpoint]();
    if (options?.method === 'POST' || options?.method === 'DELETE') return Response.json({ ok: true });
    const data: Record<string, unknown> = {
      '/me': { user: { email: 'customer@example.test' } },
      '/wallet': { availableMicros: 2000000, heldMicros: 0, giftMicros: 0, rechargeMicros: 2000000 },
      '/ledger': { ledger: [{ id: 'bill', kind: 'usage', amountUnits: '-140000000', createdAt: 1700000000000,
        call: { modelId: 'verified-model', status: 'completed', inputTokens: 100, outputTokens: 20, inputPriceMicros: 1000000, outputPriceMicros: 2000000 } }] },
      '/devices': { devices: [{ id: 'current-device', current: true, deviceName: 'Current PC' }] },
      '/models': { models: [{ id: 'model', name: 'Authorized model', inputPriceMicros: 1000000, outputPriceMicros: 2000000 }] },
    };
    return Response.json(data[endpoint]);
  });
  vi.stubGlobal('fetch', request);
  function Location() { return <output data-testid="location">{useLocation().pathname}</output>; }
  render(<MemoryRouter initialEntries={['/account']}><AccountPage modelsOnly={modelsOnly} /><Location /></MemoryRouter>);
  return { request, logout };
}

it('shows actual token usage, historical prices and sub-cent charges', async () => {
  fixture();
  expect(await screen.findByText('verified-model')).toBeTruthy();
  expect(screen.getByText('输入 100 / 输出 20')).toBeTruthy();
  expect(screen.getByText('-0.00014')).toBeTruthy();
  expect(screen.getByText('当次单价：输入 ¥1.00 / 输出 ¥2.00 每百万 Token')).toBeTruthy();
});

it('password change returns to desktop login after server confirmation', async () => {
  const { request, logout } = fixture();
  await screen.findByText('customer@example.test');
  fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'old-password-123' } });
  fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'new-password-456' } });
  fireEvent.submit(screen.getByLabelText('当前密码').closest('form')!);
  await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
  expect(request).toHaveBeenCalledWith('/api/managed/auth/change-password', expect.objectContaining({
    method: 'POST', body: JSON.stringify({ currentPassword: 'old-password-123', newPassword: 'new-password-456' }),
  }));
});

it('revoking the current device logs out instead of fetching with the revoked session', async () => {
  const { request, logout } = fixture();
  await screen.findByText('Current PC');
  await waitFor(() => expect((screen.getByRole('button', { name: '退出当前设备' }) as HTMLButtonElement).disabled).toBe(false));
  request.mockClear();
  fireEvent.click(screen.getByRole('button', { name: '退出当前设备' }));
  await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith('/api/managed/devices/current-device', expect.objectContaining({ method: 'DELETE' }));
});

it('does not invent zero balances while wallet is pending and renders other sections independently', async () => {
  fixture({ responses: { '/wallet': () => new Promise(() => {}) } });
  expect(screen.queryByText('¥ 0.00')).toBeNull();
  expect(await screen.findByText('customer@example.test')).toBeTruthy();
  expect(await screen.findByText('verified-model')).toBeTruthy();
  expect(screen.getAllByText('读取中…').length).toBeGreaterThan(0);
});

it('keeps successful sections visible when ledger fails and localizes the error', async () => {
  fixture({ responses: { '/ledger': async () => Response.json({ error: 'Internal Server Error' }, { status: 500 }) } });
  expect(await screen.findByText('customer@example.test')).toBeTruthy();
  expect(screen.getAllByText('¥ 2.00').length).toBe(2);
  expect(await screen.findByText(/账单读取失败/)).toBeTruthy();
  expect(screen.queryByText('暂无账单。')).toBeNull();
  expect(screen.queryByText(/Internal Server Error/)).toBeNull();
});

it('requests only models in modelsOnly mode, including refresh', async () => {
  const { request } = fixture({ modelsOnly: true });
  await screen.findByText('Authorized model');
  expect(request.mock.calls.map(([url]) => url)).toEqual(['/api/managed/models']);
  fireEvent.click(screen.getByRole('button', { name: '刷新' }));
  expect(await screen.findByText('刷新成功，可用模型已更新。')).toBeTruthy();
  expect(request.mock.calls.map(([url]) => url)).toEqual([
    '/api/managed/models', '/api/managed/refresh-models', '/api/managed/models',
  ]);
  expect(request).toHaveBeenCalledWith('/api/managed/refresh-models', expect.objectContaining({ method: 'POST' }));
});

it('reports authorization refresh failure while still reading independent account data', async () => {
  const { request } = fixture({ responses: {
    '/refresh-models': async () => Response.json({ error: 'Unavailable' }, { status: 503 }),
  } });
  await screen.findByText('Authorized model');
  expect(request.mock.calls.some(([url]) => url === '/api/managed/refresh-models')).toBe(false);
  request.mockClear();
  fireEvent.click(screen.getByRole('button', { name: '刷新' }));
  expect(await screen.findByText('模型授权刷新失败：服务暂不可用，请稍后重试。')).toBeTruthy();
  expect(await screen.findByText('部分数据未能更新，请查看各区域提示。')).toBeTruthy();
  expect(screen.queryByText('刷新成功，账户信息已更新。')).toBeNull();
  expect(screen.getAllByText('¥ 2.00').length).toBe(2);
  expect(request.mock.calls.map(([url]) => url)).toEqual([
    '/api/managed/refresh-models', '/api/managed/me', '/api/managed/wallet',
    '/api/managed/ledger', '/api/managed/devices', '/api/managed/models',
  ]);
});

it('shows catalog denial as an error instead of an empty catalog', async () => {
  fixture({ responses: { '/models': async () => Response.json({ code: 'APP_FORBIDDEN', error: 'Application is not authorized' }, { status: 403 }) } });
  expect(await screen.findByText(/模型读取失败.*权限/)).toBeTruthy();
  expect(screen.queryByText('暂未开放对话模型，请联系管理员。')).toBeNull();
});

it('offers conversation and learning entry points', async () => {
  fixture();
  const dispatch = vi.spyOn(window, 'dispatchEvent');
  await screen.findByText('Authorized model');
  fireEvent.click(screen.getByRole('button', { name: '开始对话' }));
  expect(screen.getByTestId('location').textContent).toBe('/');
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'pilotdeck:notification-navigate' }));
  fireEvent.click(screen.getByRole('button', { name: '进入学习' }));
  expect(screen.getByTestId('location').textContent).toBe('/education');
});

it('keeps learning accessible when chat has no models', async () => {
  fixture({ responses: { '/models': async () => Response.json({ items: [] }) } });
  expect(await screen.findByText('暂未开放对话模型，请联系管理员。')).toBeTruthy();
  expect((screen.getByRole('button', { name: '开始对话' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '进入学习' }));
  expect(screen.getByTestId('location').textContent).toBe('/education');
});

it('shows real zero balance and an actionable insufficient balance state', async () => {
  fixture({ responses: { '/wallet': async () => Response.json({ availableMicros: 0 }) } });
  expect(await screen.findByText('可用余额不足，请兑换充值后再开始对话。')).toBeTruthy();
  expect(screen.getByText('¥ 0.00')).toBeTruthy();
  expect((screen.getByRole('button', { name: '开始对话' }) as HTMLButtonElement).disabled).toBe(true);
});

it('reports successful refresh and clears recovered section errors', async () => {
  let failed = true;
  fixture({ responses: { '/wallet': async () => failed
    ? Response.json({ error: 'Unavailable' }, { status: 503 })
    : Response.json({ availableMicros: 3000000 }) } });
  await screen.findByText(/余额读取失败/);
  failed = false;
  fireEvent.click(screen.getByRole('button', { name: '刷新' }));
  expect(await screen.findByText('刷新成功，账户信息已更新。')).toBeTruthy();
  expect(screen.getByText('¥ 3.00')).toBeTruthy();
  expect(screen.queryByText(/余额读取失败/)).toBeNull();
});

it('does not report redemption failure when payment succeeded but balance refresh fails', async () => {
  let redeemed = false;
  fixture({ responses: {
    '/redeem': async () => { redeemed = true; return Response.json({ ok: true }); },
    '/wallet': async () => redeemed ? Response.json({ error: 'Unavailable' }, { status: 503 })
      : Response.json({ availableMicros: 1000000 }),
  } });
  await screen.findByText('Authorized model');
  fireEvent.change(screen.getByLabelText('兑换码'), { target: { value: 'isolated-fixture-code' } });
  fireEvent.submit(screen.getByLabelText('兑换码').closest('form')!);
  expect(await screen.findByText('兑换成功，余额暂未更新，请点击刷新重试。')).toBeTruthy();
  expect((screen.getByLabelText('兑换码') as HTMLInputElement).value).toBe('');
});

it('localizes invalid redemption and network errors', async () => {
  const { request } = fixture({ responses: {
    '/redeem': async () => Response.json({ error: 'Code is invalid or unavailable', code: 'CODE_UNAVAILABLE' }, { status: 409 }),
  } });
  await screen.findByText('Authorized model');
  fireEvent.change(screen.getByLabelText('兑换码'), { target: { value: 'isolated-invalid-code' } });
  fireEvent.submit(screen.getByLabelText('兑换码').closest('form')!);
  expect(await screen.findByText('兑换码无效、已使用或已过期，请核对后重试。')).toBeTruthy();
  request.mockRejectedValue(new TypeError('Failed to fetch'));
  fireEvent.click(screen.getByRole('button', { name: '刷新' }));
  expect(await screen.findByText(/余额读取失败.*网络连接失败/)).toBeTruthy();
  expect(screen.queryByText(/Failed to fetch/)).toBeNull();
});

it('confirms redemption and refreshes only balance and ledger', async () => {
  let redeemed = false;
  const { request } = fixture({ responses: {
    '/redeem': async () => { redeemed = true; return Response.json({ ok: true }); },
    '/wallet': async () => Response.json({ availableMicros: redeemed ? 4000000 : 1000000 }),
  } });
  await screen.findByText('Authorized model');
  request.mockClear();
  fireEvent.change(screen.getByLabelText('兑换码'), { target: { value: '  isolated-fixture-code  ' } });
  fireEvent.submit(screen.getByLabelText('兑换码').closest('form')!);
  expect(await screen.findByText('兑换成功，余额已更新。')).toBeTruthy();
  expect(screen.getByText('¥ 4.00')).toBeTruthy();
  expect(request.mock.calls.map(([url]) => url).sort()).toEqual([
    '/api/managed/ledger', '/api/managed/redeem', '/api/managed/wallet',
  ]);
  expect(request).toHaveBeenCalledWith('/api/managed/redeem', expect.objectContaining({
    body: JSON.stringify({ code: 'isolated-fixture-code' }),
  }));
});

it('shows session expiry in Chinese without inventing balances or empty ledgers', async () => {
  const unauthorized = async () => Response.json({ error: 'Unauthorized' }, { status: 401 });
  fixture({ responses: { '/wallet': unauthorized, '/ledger': unauthorized } });
  expect(await screen.findByText('余额读取失败：登录已失效，请重新登录。')).toBeTruthy();
  expect(screen.queryByText('¥ 0.00')).toBeNull();
  expect(screen.queryByText('暂无账单。')).toBeNull();
});

it('does not declare insufficient funds from a rounded micros balance when precise funds remain', async () => {
  fixture({ responses: { '/wallet': async () => Response.json({ availableMicros: 0, availableUnits: '999997' }) } });
  await screen.findByText('Authorized model');
  expect(screen.getByText('¥ 0.000000999997')).toBeTruthy();
  expect(screen.queryByText('可用余额不足，请兑换充值后再开始对话。')).toBeNull();
  expect((screen.getByRole('button', { name: '开始对话' }) as HTMLButtonElement).disabled).toBe(false);
});

it('leaves local mode alone without account requests', () => {
  state.managed = false;
  const { request } = fixture();
  expect(screen.getByText('当前使用本机模式。')).toBeTruthy();
  expect(request).not.toHaveBeenCalled();
});
