import { mkdir, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { verifyDownloadedFile, type UpdateState } from './updates';

type Release = { id: string; version: string; notes: string; downloadUrl: string; sha256: string; sizeBytes: number; platform: string; createdAt: number };
export function managedRelease(value: unknown): Release {
  const release = value as Release;
  const url = new URL(release.downloadUrl);
  if (url.protocol !== 'https:' || url.username || url.password || !/^\d+\.\d+\.\d+$/.test(release.version) ||
      release.platform !== 'win32-x64' || !/^[a-f0-9]{64}$/i.test(release.sha256) ||
      !Number.isSafeInteger(release.sizeBytes) || release.sizeBytes < 1 || release.sizeBytes > 20_000_000_000) {
    throw new Error('invalidUpdateMetadata');
  }
  return release;
}
export function compareManagedVersions(a: string, b: string) {
  const left = a.replace(/^v/, '').split('.').map(Number);
  const right = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1; }
  return 0;
}
export function createManagedUpdates(options: {
  version: string; directory: string; packaged: boolean;
  releases: () => Promise<unknown[]>;
  confirmInstall: (version: string) => Promise<boolean>;
  stillCurrent?: () => boolean;
  install: (file: string) => Promise<void>;
  request?: typeof fetch;
}) {
  let state: UpdateState = { state: 'idle', progress: 0 };
  let task: Promise<void> | null = null;
  let controller: AbortController | undefined;
  let resume: (() => void) | undefined;
  const status = () => ({ ...state });
  async function waitForResume() {
    while (state.state === 'paused' && !controller!.signal.aborted) {
      await new Promise<void>(resolve => {
        const wake = () => { controller?.signal.removeEventListener('abort', wake); resolve(); };
        resume = wake;
        controller!.signal.addEventListener('abort', wake, { once: true });
      });
    }
    controller!.signal.throwIfAborted();
  }
  async function latest() {
    const releases = (await options.releases()).filter((item: any) =>
      item?.platform === 'win32-x64' && /^\d+\.\d+\.\d+$/.test(item?.version))
      .map(managedRelease).sort((a, b) => compareManagedVersions(b.version, a.version));
    return releases[0] || null;
  }
  async function check() {
    try {
      const release = await latest();
      const hasUpdate = Boolean(release && compareManagedVersions(options.version, release.version) < 0);
      return { current: { version: options.version }, latest: release ? { version: release.version, publishedAt: new Date(release.createdAt).toISOString() } : null,
        hasUpdate, canDownload: hasUpdate && options.packaged, checkUnavailable: false, reason: options.packaged ? null : 'development' };
    } catch {
      return { current: { version: options.version }, latest: null, hasUpdate: false, canDownload: false, checkUnavailable: true, reason: 'checkFailed' };
    }
  }
  async function download() {
    if (!options.packaged) throw new Error('development');
    if (options.stillCurrent && !options.stillCurrent()) throw new Error('accountChanged');
    const release = await latest();
    if (!release || compareManagedVersions(options.version, release.version) >= 0) throw new Error('upToDate');
    controller!.signal.throwIfAborted();
    await mkdir(options.directory, { recursive: true });
    const file = path.join(options.directory, `PilotDeck-${release.version}-${release.sha256.slice(0, 16)}-setup.exe`);
    let installed = false;
    try {
      const response = await (options.request || fetch)(release.downloadUrl, {
        redirect: 'error', signal: controller!.signal,
        // Login credentials must never be sent to the download origin.
        headers: { Accept: 'application/octet-stream' },
      });
      if (!response.ok || !response.body) throw new Error('updateFailed');
      const source = Readable.fromWeb(response.body as any);
      let transferred = 0;
      state = { state: 'downloading', version: release.version, progress: 0, total: release.sizeBytes, transferred: 0 };
      const bounded = async function* () {
        for await (const chunk of source) {
          await waitForResume();
          transferred += chunk.length;
          if (transferred > release.sizeBytes) throw new Error('checksumMismatch');
          state = { ...state, transferred, progress: transferred / release.sizeBytes };
          yield chunk;
        }
      };
      await pipeline(bounded(), createWriteStream(file, { flags: 'w', mode: 0o600 }), { signal: controller!.signal });
      await waitForResume();
      state = { ...state, state: 'verifying' };
      await verifyDownloadedFile(file, { name: path.basename(file), size: release.sizeBytes, sha256: release.sha256, platform: 'win32', arch: 'x64' });
      controller!.signal.throwIfAborted();
      if (options.stillCurrent && !options.stillCurrent()) throw new Error('accountChanged');
      if (!await options.confirmInstall(release.version)) { state = { state: 'cancelled', progress: 0 }; return; }
      controller!.signal.throwIfAborted();
      if (options.stillCurrent && !options.stillCurrent()) throw new Error('accountChanged');
      state = { ...state, state: 'installing' };
      await options.install(file);
      installed = true;
    } finally { if (!installed) await rm(file, { force: true }); }
  }
  return {
    check, status,
    start() {
      if (task) return status();
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 60 * 60 * 1000);
      timeout.unref();
      state = { state: 'checking', progress: 0 };
      task = download().catch(error => {
        state = { ...state, state: controller?.signal.aborted ? 'cancelled' : 'failed',
          reason: ['checksumMismatch', 'invalidUpdateMetadata', 'upToDate', 'development'].includes(error.message) ? error.message : 'updateFailed' };
      }).finally(() => { clearTimeout(timeout); task = null; controller = undefined; resume = undefined; });
      return status();
    },
    cancel() { if (['checking', 'downloading', 'paused', 'verifying'].includes(state.state)) { controller?.abort(); resume?.(); } return status(); },
    pause() { if (state.state === 'downloading') state = { ...state, state: 'paused' }; return status(); },
    resume() { if (state.state === 'paused') { state = { ...state, state: 'downloading' }; resume?.(); resume = undefined; } return status(); },
    wait: () => task,
  };
}
