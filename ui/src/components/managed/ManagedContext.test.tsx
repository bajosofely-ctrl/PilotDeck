// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ManagedProvider, useManaged } from './ManagedContext';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete window.pilotdeckDesktop;
});

function Mode() {
  return <div>{useManaged() ? 'customer-mode' : 'local-mode'}</div>;
}

it('keeps customer settings protected before status resolves and during an outage', async () => {
  Object.defineProperty(window, 'pilotdeckDesktop', { configurable: true, value: { managed: true } });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
  render(<ManagedProvider><Mode /></ManagedProvider>);
  expect(screen.getByText('customer-mode')).toBeTruthy();
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('local-mode')).toBeNull();
});

it('returns a revoked session to the desktop login', async () => {
  const managedLogout = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(window, 'pilotdeckDesktop', { configurable: true, value: { managed: true, managedLogout } });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ enabled: true, sessionValid: false })));
  render(<ManagedProvider><Mode /></ManagedProvider>);
  await waitFor(() => expect(managedLogout).toHaveBeenCalledTimes(1));
});

it('preserves the original local mode', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ enabled: false, sessionValid: true })));
  render(<ManagedProvider><Mode /></ManagedProvider>);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(screen.getByText('local-mode')).toBeTruthy();
});
