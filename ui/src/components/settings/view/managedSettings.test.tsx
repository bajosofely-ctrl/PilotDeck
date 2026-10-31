// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { normalizeDesktopVersionResult } from '../version';
import type { SettingsMenuKey } from '../types';
import SettingsContent from './SettingsContent';
import SettingsSidebar from './SettingsSidebar';

const state = vi.hoisted(() => ({ managed: true }));
vi.mock('../../managed/ManagedContext', () => ({ useManaged: () => state.managed }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../managed/AccountPage', () => ({
  default: ({ modelsOnly }: { modelsOnly?: boolean }) => <div>{modelsOnly ? 'Catalog fixture' : 'Account fixture'}</div>,
}));
vi.mock('./modelPool', () => ({ default: () => <div>Local provider editor</div> }));
vi.mock('./agentSearch', () => ({ default: () => <div>Local search editor</div> }));
vi.mock('./advanced', () => ({ default: () => <div>Local advanced editor</div> }));
vi.mock('./usage', () => ({ default: () => <div>Local usage</div> }));
afterEach(() => { cleanup(); state.managed = true; });

function content(selectedKey: SettingsMenuKey) {
  render(<MemoryRouter><SettingsContent selectedKey={selectedKey} projects={[]}
    versionInfo={normalizeDesktopVersionResult({})} checkingVersion={false} onCheckUpdates={async () => {}} /></MemoryRouter>);
}

it('names managed sidebar destinations for customers', () => {
  render(<SettingsSidebar selectedKey="modelPool" onSelect={vi.fn()} onClose={vi.fn()} />);
  for (const label of ['可用模型', '账户与账单', '搜索服务', '托管服务']) {
    expect(screen.getByRole('button', { name: label })).toBeTruthy();
  }
  expect(screen.queryByText('settingsPage.menu.modelPool')).toBeNull();
});

it.each([
  ['modelPool', '可用模型', 'Catalog fixture'],
  ['usage', '账户与账单', 'Account fixture'],
] as const)('uses managed %s headings without local setup instructions', async (key, title, child) => {
  content(key);
  expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
  expect(await screen.findByText(child)).toBeTruthy();
  expect(screen.queryByText(`settingsPage.descriptions.${key}`)).toBeNull();
});

it.each([['agentSearch', '搜索服务'], ['advanced', '托管服务']] as const)(
  'shows a read-only managed %s state instead of an unrelated catalog or editable keys', (key, title) => {
    content(key);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
    expect(screen.getByText(/由管理员统一管理/)).toBeTruthy();
    expect(screen.queryByText('Catalog fixture')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText(`settingsPage.descriptions.${key}`)).toBeNull();
  },
);

it.each([
  ['modelPool', 'Local provider editor'],
  ['agentSearch', 'Local search editor'],
  ['advanced', 'Local advanced editor'],
  ['usage', 'Local usage'],
] as const)('preserves the local %s editor', async (key, child) => {
  state.managed = false;
  content(key);
  expect(await screen.findByText(child)).toBeTruthy();
  expect(screen.getByText(`settingsPage.descriptions.${key}`)).toBeTruthy();
});

it('preserves local sidebar labels', () => {
  state.managed = false;
  render(<SettingsSidebar selectedKey="modelPool" onSelect={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'settingsPage.menu.modelPool' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'settingsPage.menu.usage' })).toBeTruthy();
});
