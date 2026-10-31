// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../../App';

vi.unmock('lucide-react');
const { workbenchMounted } = vi.hoisted(() => ({ workbenchMounted: vi.fn() }));
const passThrough = ({ children }: { children: ReactNode }) => {
  workbenchMounted();
  return children;
};

vi.mock('react-i18next', () => ({ I18nextProvider: (props: { children: ReactNode }) => passThrough(props), useTranslation: () => ({ i18n: { resolvedLanguage: 'en' } }) }));
vi.mock('../../i18n/config.js', () => ({ default: {} }));
vi.mock('../../contexts/ThemeContext', () => ({ ThemeProvider: (props: { children: ReactNode }) => passThrough(props), useTheme: () => ({ themeMode: 'light' }) }));
vi.mock('../auth', async () => ({
  AuthProvider: (props: { children: ReactNode }) => passThrough(props),
  ProtectedRoute: (await import('../auth/view/ProtectedRoute')).default,
}));
const { authState } = vi.hoisted(() => ({
  authState: {
    user: null as null | { id: string },
    isLoading: false,
    needsSetup: false,
    modelConfiguration: { state: 'empty' },
    gatewayRuntime: { state: 'unmanaged' },
  },
}));
vi.mock('../auth/context/AuthContext', () => ({ useAuth: () => authState }));
vi.mock('../auth/view/LoginForm', () => ({ default: () => <div>Login required</div> }));
vi.mock('../auth/view/AuthLoadingScreen', () => ({ default: () => <div>Loading</div> }));
vi.mock('../auth/view/ModelConfigurationErrorScreen', () => ({ default: () => <div>Model error</div> }));
vi.mock('../onboarding/view/Onboarding', () => ({ default: () => null }));
vi.mock('../../contexts/TaskMasterContext', () => ({ TaskMasterProvider: (props: { children: ReactNode }) => passThrough(props) }));
vi.mock('../../contexts/TasksSettingsContext', () => ({ TasksSettingsProvider: (props: { children: ReactNode }) => passThrough(props) }));
vi.mock('../../contexts/WebSocketContext', () => ({ WebSocketProvider: (props: { children: ReactNode }) => passThrough(props) }));
vi.mock('../../contexts/PluginsContext', () => ({ PluginsProvider: (props: { children: ReactNode }) => passThrough(props) }));
vi.mock('../../contexts/ToastContext', () => ({ ToastProvider: (props: { children: ReactNode }) => passThrough(props) }));
vi.mock('../ui/ConfirmDialog', () => ({ ConfirmProvider: (props: { children: ReactNode }) => passThrough(props) }));
vi.mock('../desktop/ZoomIndicator', () => ({ default: () => { workbenchMounted(); return null; } }));
vi.mock('../app-shell/AppShellV2', () => ({ default: () => <div>Workbench</div> }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  window.__ROUTER_BASENAME__ = '';
  authState.user = null;
  authState.modelConfiguration = { state: 'empty' };
  authState.gatewayRuntime = { state: 'unmanaged' };
});

it.each(['/education', '/education/knowledge', '/education/ai-literacy', '/education/study-coach', '/education/training-lab', '/education/ai-classroom', '/education/missing'])(
  'requires PilotDeck authentication for %s',
  (path) => {
    const fetchRuntime = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchRuntime);
    window.history.replaceState(null, '', path);
    render(<App />);
    expect(screen.queryByText('Workbench')).toBeNull();
    expect(fetchRuntime).not.toHaveBeenCalled();
    expect(screen.getByText('Login required')).toBeTruthy();
  },
);

it.each(['/education', '/p/example'])('opens the authenticated workbench at %s', (path) => {
  authState.user = { id: 'test-user' };
  window.history.replaceState(null, '', path);
  render(<App />);
  expect(screen.getByText('Workbench')).toBeTruthy();
  expect(workbenchMounted).toHaveBeenCalled();
});

it.each(['loading', 'needs_configuration', 'invalid', 'status_error'])(
  'keeps education accessible after login when model configuration is %s',
  (state) => {
    authState.user = { id: 'test-user' };
    authState.modelConfiguration = { state };
    authState.gatewayRuntime = { state: 'error' };
    window.history.replaceState(null, '', '/education');
    render(<App />);
    expect(screen.getByText('Workbench')).toBeTruthy();
  },
);
