import fs from 'node:fs';
import path from 'node:path';
import { managedProfile, type ManagedAccount } from './managedAccounts';

type Encryption = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  getSelectedStorageBackend?: () => string;
};
const MAX_CACHE_AGE = 7 * 24 * 60 * 60 * 1000;

export function managedNetworkUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const failure = error as { name?: string; code?: string; cause?: { code?: string } };
  if (failure.name === 'TimeoutError') return true;
  return new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH',
    'EHOSTUNREACH', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'])
    .has(failure.cause?.code ?? failure.code ?? '');
}

export class ManagedSessionCache {
  constructor(
    private readonly userData: string,
    private readonly serviceOrigin: string,
    private readonly encryption: Encryption,
    private readonly now = Date.now,
  ) {}

  available(): boolean {
    return this.encryption.isEncryptionAvailable()
      && this.encryption.getSelectedStorageBackend?.() !== 'basic_text';
  }

  private file(id: string): string {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid cached account');
    return path.join(this.userData, 'accounts', id, 'managed-session.bin');
  }

  save(account: ManagedAccount): void {
    if (!this.available() || account.offline) return;
    const profile = managedProfile(this.userData, this.serviceOrigin, account.user);
    if (account.serviceOrigin !== this.serviceOrigin || profile.profilePath !== account.profilePath) throw new Error('Invalid cached account');
    fs.mkdirSync(profile.profilePath, { recursive: true });
    const target = this.file(path.basename(profile.profilePath));
    const encrypted = this.encryption.encryptString(JSON.stringify({
      token: account.token, user: account.user, serviceOrigin: this.serviceOrigin, verifiedAt: this.now(),
    }));
    fs.writeFileSync(`${target}.tmp`, encrypted, { mode: 0o600 });
    fs.renameSync(`${target}.tmp`, target);
  }

  remove(id: string): void {
    fs.rmSync(this.file(id), { force: true });
  }

  load(id: string): ManagedAccount {
    if (!this.available()) throw new Error('Secure session storage is unavailable. Please sign in online.');
    const record = JSON.parse(this.encryption.decryptString(fs.readFileSync(this.file(id))));
    const profile = managedProfile(this.userData, this.serviceOrigin, record.user);
    if (record.serviceOrigin !== this.serviceOrigin || path.basename(profile.profilePath) !== id
      || typeof record.token !== 'string' || !record.token.trim() || record.token.length > 8192
      || !Number.isFinite(record.verifiedAt) || record.verifiedAt > this.now()
      || this.now() - record.verifiedAt > MAX_CACHE_AGE) {
      throw new Error('Cached session expired or invalid. Please sign in online.');
    }
    return { ...profile, user: record.user, token: record.token, serviceOrigin: this.serviceOrigin };
  }

  list(): { id: string; email: string }[] {
    if (!this.available()) return [];
    const root = path.join(this.userData, 'accounts');
    if (!fs.existsSync(root)) return [];
    const result: { id: string; email: string }[] = [];
    for (const id of fs.readdirSync(root)) {
      if (!/^[a-f0-9]{64}$/.test(id)) continue;
      try { result.push({ id, email: this.load(id).user.email }); } catch { /* Ignore expired or undecryptable sessions. */ }
    }
    return result;
  }

  async resume(id: string, fetchImpl: typeof fetch = fetch): Promise<ManagedAccount> {
    const cached = this.load(id);
    let response: Response;
    try {
      response = await fetchImpl(`${this.serviceOrigin}/api/platform/me`, {
        headers: { Authorization: `Bearer ${cached.token}` },
        redirect: 'error', signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      if (!managedNetworkUnavailable(error)) throw error;
      return { ...cached, offline: true };
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) this.remove(id);
      throw new Error(`Account verification failed (${response.status}). Please sign in online.`);
    }
    try {
      const { user } = await response.json() as { user: unknown };
      const profile = managedProfile(this.userData, this.serviceOrigin, user);
      if (profile.profilePath !== cached.profilePath) throw new Error('Cached account identity mismatch');
      return { ...cached, user: user as ManagedAccount['user'], offline: false };
    } catch (error) {
      this.remove(id);
      throw error;
    }
  }
}

/** Persistent Chromium storage is keyed by origin, so a saved port cannot drift. */
export async function managedRuntimePorts(
  profilePath: string,
  findPort: (preferred: number, allowFallback: boolean) => Promise<number>,
): Promise<{ serverPort: number; gatewayPort: number }> {
  const file = path.join(profilePath, 'managed-ports.json');
  let saved: { serverPort: number; gatewayPort: number } | undefined;
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (saved) {
    const valid = (port: number) => Number.isInteger(port) && port > 0 && port <= 65535;
    if (!valid(saved.serverPort) || !valid(saved.gatewayPort) || saved.serverPort === saved.gatewayPort) {
      throw new Error('Invalid account runtime ports.');
    }
    await findPort(saved.serverPort, false);
    await findPort(saved.gatewayPort, false);
    return saved;
  }
  const serverPort = await findPort(3001, true);
  let gatewayPort = await findPort(18789, true);
  while (gatewayPort === serverPort) gatewayPort = await findPort(18790, true);
  const ports = { serverPort, gatewayPort };
  fs.writeFileSync(file, JSON.stringify(ports), { mode: 0o600, flag: 'wx' });
  return ports;
}

const learningPorts = {
  PILOTDECK_EDUCATION_PORT: 3010,
  PILOTDECK_AI_LESSONS_PORT: 3011,
  PILOTDECK_STUDY_COACH_PORT: 3012,
  PILOTDECK_TRAINING_LAB_PORT: 3013,
  PILOTDECK_AI_CLASSROOM_PORT: 3015,
};

export async function managedLearningPorts(
  profilePath: string,
  reserved: number[],
  findPort: (preferred: number, allowFallback: boolean) => Promise<number>,
): Promise<NodeJS.ProcessEnv> {
  const file = path.join(profilePath, 'managed-learning-ports.json');
  let saved: Record<string, number> | undefined;
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const selected: Record<string, number> = {};
  const used = new Set(reserved);
  for (const [name, preferred] of Object.entries(learningPorts)) {
    let port = saved ? saved[name] : await findPort(preferred, true);
    if (!saved) {
      for (let retry = 0; used.has(port) && retry < 50; retry++) {
        port = await findPort(preferred + retry + 1, true);
      }
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535 || used.has(port)) {
      throw new Error('Invalid account learning ports.');
    }
    if (saved) await findPort(port, false);
    used.add(port);
    selected[name] = port;
  }
  if (!saved) fs.writeFileSync(file, JSON.stringify(selected), { mode: 0o600, flag: 'wx' });
  return Object.fromEntries(Object.entries(selected).map(([name, port]) => [name, String(port)]));
}
