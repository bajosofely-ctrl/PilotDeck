import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';

export type ManagedUser = { id: string; email: string; role: 'user'; status: 'active' };
export type ManagedAccount = {
  token: string;
  user: ManagedUser;
  serviceOrigin: string;
  profilePath: string;
  partition: string;
  offline?: boolean;
};
export type ManagedAuthAction = 'login' | 'register' | 'code' | 'reset-password' | 'resume';

export function managedServiceOrigin(value: string | undefined): string | null {
  if (value === undefined) return null;
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PILOTDECK_MANAGED_URL must be an HTTPS service origin (HTTP is allowed on loopback).');
  }
  return url.origin;
}

function customer(value: unknown): ManagedUser {
  const user = value as Partial<ManagedUser> | null;
  if (!user || typeof user.id !== 'string' || !user.id.trim() || user.id.length > 512
    || typeof user.email !== 'string' || user.role !== 'user' || user.status !== 'active') {
    throw new Error('An active customer account is required. Administrator accounts cannot sign in here.');
  }
  return { id: user.id, email: user.email, role: user.role, status: user.status };
}

export function managedProfile(userData: string, serviceOrigin: string, value: unknown) {
  const user = customer(value);
  const digest = createHash('sha256').update(serviceOrigin + user.id).digest('hex');
  return { profilePath: path.join(userData, 'accounts', digest), partition: `persist:managed-${digest}` };
}

export function managedRuntimeEnvironment(account: ManagedAccount): NodeJS.ProcessEnv {
  return {
    PILOTDECK_MANAGED_URL: account.serviceOrigin,
    PILOTDECK_MANAGED_TOKEN: account.token,
    PILOTDECK_MANAGED_USER_ID: account.user.id,
    PILOTDECK_MANAGED_LOCAL_KEY: randomBytes(32).toString('hex'),
    PILOTDECK_MANAGED_OFFLINE: account.offline ? '1' : '0',
    PILOT_HOME: account.profilePath,
    // General workspaces must be neither a parent nor a child of PILOT_HOME.
    WORKSPACES_ROOT: path.join(path.dirname(account.profilePath), `${path.basename(account.profilePath)}-workspaces`),
    PILOTDECK_CONFIG_DIR: account.profilePath,
    PILOTDECK_CONFIG_PATH: path.join(account.profilePath, 'pilotdeck.yaml'),
    DATABASE_PATH: path.join(account.profilePath, 'pilotdeck.db'),
  };
}

type Sender = { mainFrame: unknown };
export function requireManagedSender(
  event: { sender: Sender; senderFrame: { url: string } | null },
  owner: Sender | null,
  documentUrl: string,
): void {
  if (!owner || event.sender !== owner || event.senderFrame !== owner.mainFrame
    || !event.senderFrame || event.senderFrame.url !== documentUrl) {
    throw new Error('Invalid managed account sender');
  }
}

export async function managedAuthRequest(
  serviceOrigin: string,
  action: unknown,
  input: unknown,
  device: { id: string; name: string },
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  if (!['login', 'register', 'code', 'reset-password'].includes(String(action))) throw new Error('Invalid account action');
  const fields = input as Record<string, unknown> | null;
  const text = (key: string, max: number) => {
    const value = fields?.[key];
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${key}`);
    return value;
  };
  const body: Record<string, string> = { email: text('email', 320).trim() };
  if (action === 'code') {
    const purpose = text('purpose', 32);
    if (purpose !== 'register' && purpose !== 'reset-password') throw new Error('Invalid verification purpose');
    body.purpose = purpose;
  } else {
    body.password = text('password', 1024);
    if (action !== 'login') body.code = text('code', 128).trim();
    if (action === 'login' || action === 'register') {
      body.deviceId = device.id;
      body.deviceName = device.name;
    }
  }
  const response = await fetchImpl(`${serviceOrigin}/api/platform/auth/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    redirect: 'error', signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json() as { error?: unknown };
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : `Account service returned ${response.status}`);
  return result;
}

type Options = {
  userData: string;
  serviceOrigin: string;
  authenticate: (action: ManagedAuthAction, input: unknown) => Promise<unknown>;
  stopRuntime: () => Promise<void>;
  openAccount: (account: ManagedAccount) => Promise<void>;
  closeAccount: (account: ManagedAccount) => Promise<void>;
  showLogin: () => Promise<void>;
  revoke: (account: ManagedAccount) => Promise<void>;
  isQuitting: () => boolean;
};

/** A failed stop keeps ownership of the old profile; another login cannot bypass it. */
export class ManagedAccounts {
  current: ManagedAccount | null = null;
  pending: Promise<void> | null = null;

  constructor(private readonly options: Options) {}

  private transition(operation: () => Promise<void>): Promise<void> {
    if (this.pending) return Promise.reject(new Error('An account operation is already in progress.'));
    if (this.options.isQuitting()) return Promise.reject(new Error('PilotDeck is closing.'));
    const pending = operation();
    this.pending = pending;
    void pending.then(() => { this.pending = null; }, () => { this.pending = null; });
    return pending;
  }

  submit(action: ManagedAuthAction, input: unknown): Promise<void> {
    return this.transition(async () => {
      if (this.current) throw new Error('Please sign out before signing in to another account.');
      const response = await this.options.authenticate(action, input);
      if (action !== 'login' && action !== 'register' && action !== 'resume') return;
      const result = response as { token?: unknown; user?: unknown; offline?: boolean } | null;
      const user = customer(result?.user);
      if (typeof result?.token !== 'string' || !result.token.trim() || result.token.length > 8192) {
        throw new Error('Invalid account session');
      }
      const account = {
        token: result.token, user, serviceOrigin: this.options.serviceOrigin,
        offline: action === 'resume' && result.offline === true,
        ...managedProfile(this.options.userData, this.options.serviceOrigin, user),
      };
      if (this.options.isQuitting()) throw new Error('PilotDeck is closing.');
      await this.options.stopRuntime();
      if (this.options.isQuitting()) throw new Error('PilotDeck is closing.');
      this.current = account;
      try { await this.options.openAccount(account); }
      catch (error) {
        // Roll back only after cleanup succeeds. A failed stop must retain the
        // account that still owns those processes, just like failed logout.
        await this.options.stopRuntime();
        await this.options.closeAccount(account);
        this.current = null;
        if (!this.options.isQuitting()) await this.options.showLogin();
        throw error;
      }
    });
  }

  logout(): Promise<void> {
    return this.transition(async () => {
      const account = this.current;
      if (!account) return;
      await this.options.stopRuntime();
      await this.options.closeAccount(account);
      // Revocation can be unavailable offline; local logout still completes.
      await this.options.revoke(account).catch(() => undefined);
      this.current = null;
      if (!this.options.isQuitting()) await this.options.showLogin();
    });
  }
}
