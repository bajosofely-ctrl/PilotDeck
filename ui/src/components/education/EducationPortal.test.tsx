// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EducationPortal from './EducationPortal';

vi.unmock('lucide-react');
const moduleName = '中小学知识图谱与学习诊断';
const fetchRuntime = vi.fn<typeof fetch>();
const ready = (url = 'http://localhost:3010/') => new Response(JSON.stringify({ status: 'ready', url }), { status: 200 });
function renderPortal(path = '/education/knowledge') {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <EducationPortal />
    </MemoryRouter>,
  );
}
beforeEach(() => { fetchRuntime.mockReset(); vi.stubGlobal('fetch', fetchRuntime); });
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('education workspace view', () => {
  it.each([
    ['AI 通识与实验', 'ai-literacy', '3011'],
    ['AI 学习教练', 'study-coach', '3012'],
    ['AI 训练实验室', 'training-lab', '3013'],
    ['AI 使用小课堂', 'ai-classroom', '3015'],
  ])('opens %s on its own origin and returns to selection', async (name, id, port) => {
    fetchRuntime.mockImplementation(async () => ready(`http://localhost:${port}/`));
    renderPortal('/education');
    expect(screen.getByRole('button', { name })).toBeTruthy();
    expect(fetchRuntime).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name }));
    expect((await screen.findByTitle(name)).getAttribute('src')).toBe(`http://localhost:${port}/`);
    expect(fetchRuntime).toHaveBeenCalledWith(`/education/runtime.json?module=${id}`, expect.anything());
    fireEvent.click(screen.getByRole('button', { name: '返回学习' }));
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('button', { name: moduleName })).toBeTruthy();
  });

  it('polls only the selected module', async () => {
    vi.useFakeTimers();
    fetchRuntime.mockImplementation(async () => ready('http://localhost:3011/'));
    renderPortal('/education/ai-literacy');
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(fetchRuntime).toHaveBeenLastCalledWith('/education/runtime.json?module=ai-literacy&check=1', expect.anything());
  });

  it.each([
    ['training-lab', 'camera; microphone; autoplay; clipboard-write'],
    ['knowledge', 'clipboard-write'],
  ])('limits capture permissions to the selected %s module', async (id, permissions) => {
    fetchRuntime.mockImplementation(async () => ready('http://localhost:3013/'));
    renderPortal(`/education/${id}`);
    await waitFor(() => expect(document.querySelector('iframe')?.getAttribute('allow')).toBe(permissions));
  });

  it('shows a module button without loading the iframe until the user selects it', async () => {
    fetchRuntime.mockImplementation(async () => ready());
    renderPortal('/education');
    expect(screen.getByRole('heading', { name: '学习' })).toBeTruthy();
    expect(document.querySelector('iframe')).toBeNull();
    expect(fetchRuntime).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: moduleName }));
    expect(await screen.findByTitle(moduleName)).toBeTruthy();
    expect(document.querySelector('iframe')?.getAttribute('src')).toBe('http://localhost:3010/');
    fireEvent.click(screen.getByRole('button', { name: '返回学习' }));
    expect(screen.getByRole('button', { name: moduleName })).toBeTruthy();
    expect(document.querySelector('iframe')).toBeNull();
    expect(fetchRuntime).toHaveBeenCalledTimes(1);
  });

  it('stops status polling when returning to the module selection page', async () => {
    vi.useFakeTimers();
    fetchRuntime.mockImplementation(async () => ready());
    renderPortal();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(document.querySelector('iframe')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '返回学习' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchRuntime).toHaveBeenCalledTimes(1);
    expect(document.querySelector('iframe')).toBeNull();
  });
});
describe('education module host', () => {
  it('authenticates host metadata requests without sharing the token with the iframe', async () => {
    localStorage.setItem('auth-token', 'test-pilotdeck-token');
    fetchRuntime.mockImplementation(async () => ready());
    renderPortal();
    const frame = await screen.findByTitle(moduleName);
    expect(fetchRuntime).toHaveBeenCalledWith('/education/runtime.json', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer test-pilotdeck-token' }),
    }));
    expect(frame.getAttribute('src')).toBe('http://localhost:3010/');
  });

  it('opens the workspace sidebar when it is collapsed', () => {
    fetchRuntime.mockImplementation(() => new Promise(() => {}));
    const openSidebar = vi.fn();
    render(
      <MemoryRouter initialEntries={['/education']}>
        <EducationPortal isSidebarCollapsed onOpenSidebar={openSidebar} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '展开侧栏' }));
    expect(openSidebar).toHaveBeenCalledOnce();
  });

  it('embeds only the validated origin with explicit isolation', async () => {
    fetchRuntime.mockResolvedValue(ready()); renderPortal();
    const frame = await screen.findByTitle(moduleName);
    expect(frame.getAttribute('sandbox')?.split(' ')).toEqual(['allow-scripts', 'allow-same-origin', 'allow-forms', 'allow-downloads', 'allow-modals', 'allow-popups', 'allow-popups-to-escape-sandbox']);
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(fetchRuntime).toHaveBeenCalledWith('/education/runtime.json', expect.objectContaining({ signal: expect.any(AbortSignal), cache: 'no-store', redirect: 'error' }));
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button', { name: '在独立窗口打开' })).toBeNull();
  });
  it.each(['starting', 'error'])('shows a retryable %s response and recovers', async status => {
    fetchRuntime.mockResolvedValueOnce(new Response(JSON.stringify({ status, message: '教育服务暂不可用' }), { status: 503 })).mockResolvedValueOnce(ready('http://127.0.0.1:3010/'));
    renderPortal(); expect(await screen.findByText('教育服务暂不可用')).toBeTruthy();
    expect(document.querySelector('iframe')).toBeNull(); fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect((await screen.findByTitle(moduleName)).getAttribute('src')).toBe('http://127.0.0.1:3010/');
  });
  it('recovers from network failure and reloads using fresh metadata', async () => {
    fetchRuntime.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockImplementation(async () => ready());
    renderPortal(); expect(await screen.findByRole('alert')).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: '重试' }));
    const firstFrame = await screen.findByTitle(moduleName); fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await waitFor(() => expect(screen.getByTitle(moduleName)).not.toBe(firstFrame)); expect(fetchRuntime).toHaveBeenCalledTimes(3);
  });
  it('times out a hanging request and offers retry', async () => {
    vi.useFakeTimers(); fetchRuntime.mockImplementation(() => new Promise(() => {})); renderPortal();
    const signal = fetchRuntime.mock.calls[0][1]?.signal; await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(signal?.aborted).toBe(true); expect(screen.getByRole('alert').textContent).toMatch(/超时/); expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
  });
  it('detects a stopped child after readiness without an iframe error event', async () => {
    vi.useFakeTimers(); fetchRuntime.mockResolvedValueOnce(ready()).mockResolvedValueOnce(new Response(JSON.stringify({ status: 'error', message: '教育服务已停止，请重试。' }), { status: 503 })).mockResolvedValueOnce(ready());
    renderPortal(); await act(async () => { await vi.advanceTimersByTimeAsync(0); }); expect(document.querySelector('iframe')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(fetchRuntime).toHaveBeenLastCalledWith('/education/runtime.json?check=1', expect.objectContaining({ cache: 'no-store' }));
    expect(document.querySelector('iframe')).toBeNull(); expect(screen.getByRole('alert').textContent).toContain('教育服务已停止');
    fireEvent.click(screen.getByRole('button', { name: '重试' })); await act(async () => { await vi.advanceTimersByTimeAsync(0); }); expect(document.querySelector('iframe')).toBeTruthy();
    cleanup(); await act(async () => { await vi.advanceTimersByTimeAsync(20_000); }); expect(fetchRuntime).toHaveBeenCalledTimes(3);
  });
  it('preserves the same iframe through a failed passive check and recovery', async () => {
    vi.useFakeTimers();
    fetchRuntime.mockResolvedValueOnce(ready())
      .mockRejectedValueOnce(new TypeError('Temporary network failure'))
      .mockImplementation(async () => ready());
    renderPortal();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const frame = document.querySelector('iframe');
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(document.querySelector('iframe')).toBe(frame);
    expect(screen.getByText(/状态检查暂时失败/)).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(document.querySelector('iframe')).toBe(frame);
    expect(screen.queryByText(/状态检查暂时失败/)).toBeNull();
  });
  it('keeps unsaved iframe state when a passive check times out and uses a fresh signal to retry', async () => {
    vi.useFakeTimers();
    fetchRuntime.mockResolvedValueOnce(ready())
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementation(async () => ready());
    renderPortal();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const frame = document.querySelector('iframe');
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(document.querySelector('iframe')).toBe(frame);
    expect(fetchRuntime.mock.calls[1][1]?.signal?.aborted).toBe(true);
    expect(screen.getByText(/状态检查暂时失败/)).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(fetchRuntime.mock.calls[2][1]?.signal?.aborted).toBe(false);
    expect(document.querySelector('iframe')).toBe(frame);
    expect(screen.queryByText(/状态检查暂时失败/)).toBeNull();
  });
  it('does not preserve a frame after the host explicitly rejects authentication', async () => {
    vi.useFakeTimers();
    fetchRuntime.mockResolvedValueOnce(ready())
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
    renderPortal();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('登录状态已失效');
  });
  it('aborts runtime request when protected view unmounts', () => {
    fetchRuntime.mockImplementation(() => new Promise(() => {})); const view = renderPortal(); const signal = fetchRuntime.mock.calls[0][1]?.signal;
    view.unmount(); expect(signal?.aborted).toBe(true);
  });
  it.each(['https://localhost:3010/', 'http://example.com:3010/', 'http://localhost:3001/', 'http://127.0.0.1:3001/', 'http://localhost.evil.test:3010/', '//localhost:3010/', 'javascript:alert(1)', 'http://user:password@localhost:3010/', 'http://localhost:3010/api/config', 'http://localhost:3010/?redirect=evil'])('rejects unsafe module URL %s', async url => {
    fetchRuntime.mockResolvedValue(ready(url)); renderPortal(); expect(await screen.findByRole('alert')).toBeTruthy(); expect(document.querySelector('iframe')).toBeNull();
  });
  it.each([new Response('<html>Not JSON</html>', { status: 200 }), new Response(JSON.stringify({ status: 'ready' }), { status: 200 }), new Response(JSON.stringify({ status: 'ready', url: 'http://localhost:3010/' }), { status: 503 }), new Response('null', { status: 200 })])('handles malformed metadata without mounting a frame', async response => {
    fetchRuntime.mockResolvedValue(response); renderPortal(); expect(await screen.findByRole('alert')).toBeTruthy(); expect(document.querySelector('iframe')).toBeNull(); expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
  });
});
