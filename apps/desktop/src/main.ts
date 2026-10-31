import { installRendererRecovery } from "./rendererRecovery";
import { commandEnabled, emptyMenuState, normalizeMenuState, type DesktopCommand } from "./desktopCommands";
import { isRendererEditingShortcut, windowChromeOptions, windowPalette, WINDOWS_CAPTION_HEIGHT } from "./windowChrome";
import { desktopAboutInfo, desktopAboutInformation, presentDesktopAbout } from "./desktopAbout";
import { WindowsCaptionMenu, type CaptionMenuRequest } from "./windowsCaptionMenu";
import { linuxCaptionAction, linuxCaptionEntries } from "./linuxCaptionMenu";
import { buildApplicationMenu } from "./applicationMenu";
import { createDesktopTray } from "./desktopTray";
import { createDesktopLifecycle } from "./desktopLifecycle";
import { badgeBitmap, createDesktopNotifications, nativeNotificationOptions } from './notifications';
import { normalizeAppearance, renderLoadingHtml, startupText, type DesktopAppearance } from "./appearance";
import { saveAppearancePatch, appearanceImagePath, writeAppearanceImage } from './appearanceStorage';
import { createFilePicker } from './filePicker';
import { ComputerUseController } from './computerUse';
import { createManagedUpdates } from './managedUpdates';
import { ManagedAccounts, managedServiceOrigin, managedRuntimeEnvironment, requireManagedSender, type ManagedAuthAction, managedAuthRequest } from './managedAccounts';
import { managedLoginDocument } from './managedLogin';
import { ManagedSessionCache, managedRuntimePorts, managedLearningPorts } from './managedStorage';
import { app, BrowserWindow, dialog, ipcMain, Menu, shell, Tray, nativeImage, powerMonitor, nativeTheme, clipboard, screen, Notification, session, safeStorage } from "electron";
import { randomUUID } from 'node:crypto';
import { DebUpdater, MacUpdater, NsisUpdater, RpmUpdater } from "electron-updater";
import { installUpdateDownloadControl } from "./updateDownload";
import { createUpdateController } from "./updates";
import { createUpdateNetwork } from "./updateNetwork";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

type ManagedProcess = {
  name: string;
  child: ChildProcess;
};

type RuntimeInfo = {
  serverPort: number;
  gatewayPort: number;
  gateway: GatewayRuntimeState;
  runtimeRoot: string;
  logPath: string;
};

type GatewayRuntimeState =
  | { state: "stopped" | "starting" | "ready" }
  | { state: "error"; error: string };

type ModelConfigurationState = {
  state: "needs_configuration" | "ready" | "empty" | "invalid";
  revision?: string;
};

type BundledGitPaths = {
  root: string;
  bash: string;
  git: string;
  pathEntries: string[];
};

type RuntimeStatus = {
  phase: "starting" | "config" | "server" | "awaiting_configuration" | "gateway" | "ready" | "error" | "stopped";
  message: string;
  logPath?: string;
  error?: string;
};

let mainWindow: BrowserWindow | null = null;
let desktopMenuState = { ...emptyMenuState };
let runtime: RuntimeManager | null = null;
let isQuitting = false;
let runtimeStartPromise: Promise<RuntimeInfo> | null = null;
let lastRuntimeStatus: RuntimeStatus | null = null;
let updateOrigin: string | null = null;
let desktopTray: ReturnType<typeof createDesktopTray> | null = null;
let managedAccounts: ManagedAccounts | null = null;
let managedLoginWindow: BrowserWindow | null = null;
let managedLoginUrl = '';
let managedWindowTransition = false;
let managedRuntimeRetry: Promise<void> | null = null;
let managedStartupUrl = '';
let managedSessionCache: ManagedSessionCache | null = null;
if (app.isPackaged) {
  const bundledServiceFile = path.join(process.resourcesPath, 'runtime', 'managed-service.json');
  if (fs.existsSync(bundledServiceFile)) {
    const bundledService = JSON.parse(fs.readFileSync(bundledServiceFile, 'utf8'));
    process.env.PILOTDECK_MANAGED_URL = managedServiceOrigin(bundledService.serviceOrigin) || undefined;
  }
}
const managedEnabled = process.env.PILOTDECK_MANAGED_URL !== undefined;

ipcMain.on('pilotdeck:managed-mode', event => { event.returnValue = managedEnabled; });

function desktopDataPath(): string {
  return managedAccounts?.current?.profilePath ?? app.getPath('userData');
}

function runtimeLoadingUrl(): string {
  let html = renderLoadingHtml(readAppearance());
  if (managedEnabled) {
    html = html.replace('</body>', `<button id="managed-sign-out" style="position:fixed;bottom:24px;right:24px">退出登录</button>
<script>document.getElementById('managed-sign-out').onclick = async () => {
  try { await window.pilotdeckDesktop.managedLogout(); }
  catch { document.getElementById('managed-sign-out').textContent = '退出失败，请重试'; }
};</script></body>`);
  }
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  if (managedEnabled) managedStartupUrl = url;
  return url;
}

async function stopDesktopRuntime(): Promise<void> {
  await managedRuntimeRetry?.catch(() => undefined);
  await runtimeStartPromise?.catch(() => undefined);
  await runtime?.stop();
  runtime = null;
  runtimeStartPromise = null;
}

async function showManagedLogin(): Promise<void> {
  if (isQuitting || !managedAccounts) return;
  if (managedLoginWindow && !managedLoginWindow.isDestroyed()) {
    if (managedLoginWindow.isMinimized()) managedLoginWindow.restore();
    managedLoginWindow.show();
    managedLoginWindow.focus();
    return;
  }
  const window = new BrowserWindow({
    width: 500, height: 650, minWidth: 420, minHeight: 600, title: 'PilotDeck',
    show: false, autoHideMenuBar: true, ...(resolveAppIcon() ? { icon: resolveAppIcon() } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'managedLoginPreload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      partition: `managed-login-${randomUUID()}`,
    },
  });
  managedLoginWindow = window;
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  lifecycle.attachWindow(window);
  window.on('closed', () => { if (managedLoginWindow === window) managedLoginWindow = null; });
  managedLoginUrl = `data:text/html;charset=utf-8,${encodeURIComponent(managedLoginDocument(managedServiceOrigin(process.env.PILOTDECK_MANAGED_URL)!))}`;
  await window.loadURL(managedLoginUrl);
  if (!isQuitting && !window.isDestroyed()) window.show();
}

function initializeManagedAccounts(): void {
  if (!managedEnabled) return;
  const serviceOrigin = managedServiceOrigin(process.env.PILOTDECK_MANAGED_URL)!;
  const userData = app.getPath('userData');
  managedSessionCache = new ManagedSessionCache(userData, serviceOrigin, {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: value => safeStorage.encryptString(value),
    decryptString: value => safeStorage.decryptString(value),
    ...(process.platform === 'linux' ? { getSelectedStorageBackend: () => safeStorage.getSelectedStorageBackend() } : {}),
  });
  const deviceFile = path.join(userData, 'managed-device-id');
  fs.mkdirSync(userData, { recursive: true });
  let deviceId: string;
  try {
    deviceId = fs.readFileSync(deviceFile, 'utf8').trim();
    if (!/^[a-f0-9-]{36}$/.test(deviceId)) throw new Error('Invalid managed device identity.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    deviceId = randomUUID();
    fs.writeFileSync(deviceFile, deviceId, { mode: 0o600, flag: 'wx' });
  }
  managedAccounts = new ManagedAccounts({
    userData, serviceOrigin, isQuitting: () => isQuitting,
    authenticate: (action, input) => action === 'resume'
      ? managedSessionCache!.resume((input as { accountId: string })?.accountId)
      : managedAuthRequest(serviceOrigin, action, input, { id: deviceId, name: os.hostname() }),
    stopRuntime: stopDesktopRuntime,
    openAccount: async account => {
      managedWindowTransition = true;
      try {
        fs.mkdirSync(account.profilePath, { recursive: true });
        try { managedSessionCache!.save(account); }
        catch { dialog.showErrorBox('PilotDeck', 'The encrypted account session could not be saved. This account will require online login next time.'); }
        session.fromPartition(account.partition).webRequest.onBeforeRequest(null);
        notifications = createNotifications();
        updateOrigin = null;
        lastRuntimeStatus = null;
        await createOrShowWindow();
        managedLoginWindow?.destroy();
        managedLoginWindow = null;
        await startRuntimeAndLoad();
      } finally { managedWindowTransition = false; }
    },
    closeAccount: async account => {
      managedWindowTransition = true;
      try {
        updateController?.cancel();
        await updateController?.wait();
        updateController = null;
        updateOrigin = null;
        mainWindow?.destroy();
        mainWindow = null;
        const previous = session.fromPartition(account.partition);
        // Block old workers and close pooled sockets before another account's
        // runtime can reuse a loopback port. Preserve local history/storage.
        previous.webRequest.onBeforeRequest((_details, callback) => callback({ cancel: true }));
        await previous.closeAllConnections();
        await previous.clearStorageData({ storages: ['serviceworkers'] });
        await previous.clearAuthCache();
        previous.flushStorageData();
        managedSessionCache!.remove(path.basename(account.profilePath));
        activeDesktopNotifications.forEach(notification => notification.close());
        activeDesktopNotifications.clear();
        notifications.badge(0);
        lastRuntimeStatus = null;
        managedStartupUrl = '';
        updateController = null;
        app.setAppLogsPath(path.join(app.getPath('userData'), 'logs'));
      } finally { managedWindowTransition = false; }
    },
    showLogin: showManagedLogin,
    revoke: async account => {
      await fetch(`${account.serviceOrigin}/api/platform/auth/logout`, {
        method: 'POST', headers: { Authorization: `Bearer ${account.token}` },
        redirect: 'error', signal: AbortSignal.timeout(5_000),
      });
    },
  });
}

ipcMain.handle('pilotdeck:managed-auth', async (event, action: ManagedAuthAction, input: unknown) => {
  requireManagedSender(event, managedLoginWindow?.webContents ?? null, managedLoginUrl);
  if (!managedAccounts || !['login', 'register', 'code', 'reset-password', 'resume'].includes(action)) throw new Error('Invalid managed action');
  try {
    await managedAccounts.submit(action, input);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Account service unavailable.' };
  }
});

ipcMain.handle('pilotdeck:managed-saved-accounts', event => {
  requireManagedSender(event, managedLoginWindow?.webContents ?? null, managedLoginUrl);
  return managedSessionCache?.list() ?? [];
});

ipcMain.handle('pilotdeck:managed-logout', async event => {
  requireManagedRuntimeSender(event);
  if (!managedAccounts) throw new Error('Managed accounts are not enabled.');
  try { await managedAccounts.logout(); }
  catch (error) {
    await createOrShowWindow();
    publishRuntimeStatus({
      phase: 'error', message: 'Sign out failed. The previous account is still selected.',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
});

function requireManagedRuntimeSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): void {
  if (!managedEnabled || !managedAccounts?.current) throw new Error('No managed account.');
  if (event.senderFrame?.url === managedStartupUrl && managedStartupUrl) {
    requireManagedSender(event, mainWindow?.webContents ?? null, managedStartupUrl);
  } else {
    requireUpdateSender(event);
  }
}

const APP_ID = "cn.pilotdeck.desktop";
const EXTERNAL_NAVIGATION_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
const PLAYWRIGHT_BROWSER_DIR = "playwright-browsers";
const DEFAULT_UPDATE_REPOSITORY = "OpenBMB/PilotDeck";
const PROCESS_LAUNCH_CWD = process.cwd();
// Electron requires this before ready; saving the preference takes effect on
// the next launch, never by changing a live window's renderer settings.
const startupHardwareAcceleration = readAppearance().interfacePreferences?.hardwareAcceleration !== false;
if (!startupHardwareAcceleration) app.disableHardwareAcceleration();

type BuildMetadata = {
  version?: string;
  buildTime?: string;
  releaseDate?: string;
  commitSha?: string;
  repository?: string;
};

class RuntimeManager {
  private readonly processes: ManagedProcess[] = [];
  private readonly expectedExits = new WeakSet<ChildProcess>();
  private readonly logPath: string;
  private logStream: fs.WriteStream | null = null;
  private info: RuntimeInfo | null = null;
  private serverProcess: ChildProcess | null = null;
  private gatewayProcess: ChildProcess | null = null;
  private gatewayStartPromise: Promise<void> | null = null;
  private gatewayStopPromise: Promise<void> | null = null;
  private commonEnv: NodeJS.ProcessEnv | null = null;
  private pilotHome: string | null = null;
  private gatewayPort: number | null = null;
  private configurationState: ModelConfigurationState | null = null;
  private gatewayState: GatewayRuntimeState = { state: "stopped" };
  private stopping = false;
  computerUse: ComputerUseController | null = null;

  constructor(
    private readonly runtimeRoot: string,
    private readonly nodeBinary: string,
    private readonly managedEnv?: NodeJS.ProcessEnv,
  ) {
    app.setAppLogsPath(path.join(desktopDataPath(), "logs"));
    this.logPath = path.join(app.getPath("logs"), "runtime.log");
  }

  getInfo(): RuntimeInfo | null {
    return this.info;
  }

  getLogPath(): string {
    return this.logPath;
  }

  async start(): Promise<RuntimeInfo> {
    this.stopping = false;
    fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
    this.logStream = fs.createWriteStream(this.logPath, { flags: "a" });
    publishRuntimeStatus({
      phase: "starting",
      message: "Preparing PilotDeck runtime...",
      logPath: this.logPath,
    });
    this.log(`PilotDeck Desktop runtime starting from ${this.runtimeRoot}`);
    publishRuntimeStatus({
      phase: "config",
      message: "Checking local configuration...",
      logPath: this.logPath,
    });
    const config = this.managedEnv
      ? { pilotHome: this.managedEnv.PILOT_HOME! }
      : ensurePilotHome((message) => this.log(message));
    fs.mkdirSync(config.pilotHome, { recursive: true });
    const computerUseDirectory = path.join(desktopDataPath(), 'computer-use');
    // macOS uses the same LaunchServices helper as standalone Web deployments.
    // Electron's own grants must not gate or request this helper's permissions.
    if (process.platform !== 'darwin') {
      this.computerUse = new ComputerUseController({
        directory: computerUseDirectory,
        resources: app.isPackaged ? path.join(process.resourcesPath, 'runtime', 'resources', 'cua-driver') : path.join(__dirname, '..', '..', '..', 'resources', 'cua-driver'),
        bundleId: APP_ID,
        permissions: () => undefined,
        requestPermission: async () => {},
        log: message => this.log(message),
      });
      await this.computerUse.initialize();
    }

    const { serverPort, gatewayPort } = this.managedEnv
      ? await managedRuntimePorts(config.pilotHome, findFreePort)
      : { serverPort: await findFreePort(3001), gatewayPort: await findFreePort(18789) };
    const learningEnv = this.managedEnv
      ? await managedLearningPorts(config.pilotHome, [serverPort, gatewayPort], findFreePort)
      : {};
    const bundledGit = resolveBundledGitPaths();
    if (bundledGit) {
      this.log(`Bundled Git Bash ready: ${bundledGit.bash}`);
    }
    const playwrightBrowsersPath = resolvePlaywrightBrowsersPath(this.runtimeRoot);
    const buildMetadata = readBuildMetadata();
    this.log(`Playwright browsers path: ${playwrightBrowsersPath}`);
    const inheritedEnv = { ...process.env };
    const configuredConfigPath = inheritedEnv.PILOTDECK_CONFIG_PATH?.trim();
    if (configuredConfigPath) {
      inheritedEnv.PILOTDECK_CONFIG_PATH = path.resolve(PROCESS_LAUNCH_CWD, configuredConfigPath);
    } else {
      delete inheritedEnv.PILOTDECK_CONFIG_PATH;
    }
    const commonEnv = withRuntimeCommandPath({
      ...inheritedEnv,
      HOME: process.env.HOME || os.homedir(),
      HOST: "127.0.0.1",
      PILOTDECK_RUNTIME_ROOT: this.runtimeRoot,
      PILOTDECK_DESKTOP_RUNTIME_ROOT: this.runtimeRoot,
      PILOT_HOME: config.pilotHome,
      PILOTDECK_CONFIG_DIR: config.pilotHome,
      SERVER_PORT: String(serverPort),
      PILOTDECK_GATEWAY_PORT: String(gatewayPort),
      PILOTDECK_GATEWAY_URL: `ws://127.0.0.1:${gatewayPort}/ws`,
      PILOTDECK_DESKTOP: "1",
      PILOTDECK_COMPUTER_USE_DIRECTORY: computerUseDirectory,
      PILOTDECK_COMPUTER_USE_MCP_CONFIG: path.join(computerUseDirectory, 'mcp.json'),
      PILOTDECK_DESKTOP_VERSION: app.getVersion(),
      PILOTDECK_VERSION: app.getVersion(),
      PILOTDECK_DESKTOP_BUILD_TIME: buildMetadata.buildTime,
      PILOTDECK_COMMIT_SHA: buildMetadata.commitSha,
      PILOTDECK_GIT_SHA: buildMetadata.commitSha,
      PILOTDECK_UPDATE_REPOSITORY:
        process.env.PILOTDECK_UPDATE_REPOSITORY || buildMetadata.repository || DEFAULT_UPDATE_REPOSITORY,
      PILOTDECK_DISABLE_LOCAL_AUTH: process.env.PILOTDECK_DISABLE_LOCAL_AUTH || "1",
      PILOTDECK_SKIP_BROWSER_OPEN: "1",
      PILOTDECK_SKIP_DEFAULT_PROJECT: "1",
      PILOTDECK_RUNTIME_SUPERVISED: "1",
      PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsersPath,
      ...this.managedEnv,
      ...learningEnv,
    }, this.runtimeRoot, this.nodeBinary, bundledGit);
    this.commonEnv = commonEnv;
    this.pilotHome = config.pilotHome;
    this.gatewayPort = gatewayPort;
    if (this.managedEnv) {
      const bootstrap = this.spawnRuntime('managed-bootstrap',
        [this.nodeBinary, path.join(this.runtimeRoot, 'ui', 'server', 'managedBootstrap.js')],
        this.runtimeRoot, commonEnv);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => finish(new Error('Managed account bootstrap timed out.')), 60_000);
        const finish = (error?: Error) => {
          clearTimeout(timer);
          bootstrap.off('error', onError);
          bootstrap.off('managed-exit', onExit);
          if (error) reject(error); else resolve();
        };
        const onError = (error: Error) => finish(error);
        const onExit = (code: number | null, _signal: unknown, startupError?: string) => {
          finish(code === 0 ? undefined : new Error(startupError || 'Managed account configuration could not be loaded. Check your connection and account access, then retry or sign out.'));
        };
        bootstrap.once('error', onError);
        bootstrap.once('managed-exit', onExit);
      }).catch(error => {
        // The bootstrap revalidates /me. Never retain an offline credential
        // after a failed second verification, including a newly revoked login.
        managedSessionCache?.remove(path.basename(config.pilotHome));
        throw error;
      });
      await this.stopManagedProcess(bootstrap);
    }
    publishRuntimeStatus({
      phase: "server",
      message: "Starting Web UI server...",
      logPath: this.logPath,
    });
    const server = this.spawnRuntime(
      "server",
      this.serverCommand(),
      path.join(this.runtimeRoot, "ui"),
      commonEnv,
      { ipc: true, critical: true },
    );
    this.serverProcess = server;
    server.on("message", (message) => this.handleServerMessage(message));
    await waitForPortOrProcessExit(server, "server", serverPort, "127.0.0.1", 90_000, this.logPath);

    this.info = {
      serverPort,
      gatewayPort,
      gateway: this.gatewayState,
      runtimeRoot: this.runtimeRoot,
      logPath: this.logPath,
    };
    this.log(`PilotDeck Web UI ready: http://127.0.0.1:${serverPort}`);
    if (!this.configurationState || this.configurationState.state !== "ready") {
      publishRuntimeStatus({
        phase: "awaiting_configuration",
        message: "PilotDeck is ready for model setup.",
        logPath: this.logPath,
      });
    }
    return this.info;
  }

  async stop(): Promise<void> {
    const failures: unknown[] = [];
    this.stopping = true;
    try { await this.computerUse?.stop(); this.computerUse = null; }
    catch (error) { failures.push(error); this.log(`Failed to stop computer use: ${String(error)}`); }
    await this.gatewayStopPromise?.catch(() => undefined);
    for (const proc of [...this.processes].reverse()) {
      this.expectedExits.add(proc.child);
      await killProcessTree(proc.child).then(() => {
        const index = this.processes.indexOf(proc);
        if (index >= 0) this.processes.splice(index, 1);
      }).catch((error) => {
        failures.push(error);
        this.log(`Failed to stop ${proc.name}: ${String(error)}`);
      });
    }
    // Killing the owned processes also settles an in-flight readiness wait.
    // The stopping flag prevents its continuation from spawning replacements.
    if (this.managedEnv) await this.gatewayStartPromise?.catch(() => undefined);
    if (failures.length) throw new Error("Failed to stop desktop runtime; process records retained for recovery");
    this.serverProcess = null;
    this.gatewayProcess = null;
    this.gatewayStartPromise = null;
    this.log("PilotDeck Desktop runtime stopped");
    this.logStream?.end();
    this.logStream = null;
    this.info = null;
    this.commonEnv = null;
    this.pilotHome = null;
    this.gatewayPort = null;
    this.gatewayStopPromise = null;
    this.configurationState = null;
    this.gatewayState = { state: "stopped" };
    publishRuntimeStatus({
      phase: "stopped",
      message: "PilotDeck runtime stopped.",
      logPath: this.logPath,
    });
  }

  private gatewayCommand(): string[] {
    const builtEntry = path.join(this.runtimeRoot, "dist", "src", "cli", "pilotdeck.js");
    if (fs.existsSync(builtEntry)) {
      return [this.nodeBinary, builtEntry, "server"];
    }
    if (app.isPackaged || process.env.PILOTDECK_DESKTOP_RUNTIME_ROOT) {
      throw new Error(`Compiled PilotDeck gateway entry not found: ${builtEntry}`);
    }
    return [this.nodeBinary, "--import", "tsx", path.join(this.runtimeRoot, "src", "cli", "pilotdeck.ts"), "server"];
  }

  private serverCommand(): string[] {
    if (app.isPackaged || process.env.PILOTDECK_DESKTOP_RUNTIME_ROOT) {
      return [this.nodeBinary, "server/index.js"];
    }
    return [this.nodeBinary, "--import", "tsx", "server/index.js"];
  }

  private spawnRuntime(
    name: string,
    command: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    options: { ipc?: boolean; critical?: boolean } = {},
  ): ChildProcess {
    const [bin, ...args] = command;
    if (!bin) throw new Error(`Missing command for ${name}`);
    const { spawnManaged } = require(path.join(this.runtimeRoot, "ui/server/utils/processTree.js"));
    const child: ChildProcess = spawnManaged(bin, args, {
      cwd,
      env,
      stdio: options.ipc
        ? ["ignore", "pipe", "pipe", "ipc"]
        : ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: process.platform === "win32",
    }, this.nodeBinary);
    this.processes.push({ name, child });
    this.log(`[${name}] spawn ${bin} ${args.join(" ")}`);

    child.stdout?.on("data", (chunk: Buffer) => this.logChunk(name, chunk));
    child.stderr?.on("data", (chunk: Buffer) => this.logChunk(name, chunk));
    child.on("managed-exit", (code, signal, startupError) => {
      // Retain the group record until stop() confirms all descendants exited.
      this.log(`[${name}] exited code=${code ?? "null"} signal=${signal ?? "null"}`);
      if (this.expectedExits.delete(child)) return;
      if (name === "gateway" && this.gatewayProcess === child) {
        this.gatewayProcess = null;
        if (!isQuitting) {
          const detail = startupError || `Gateway exited code=${code ?? "null"} signal=${signal ?? "null"}`;
          this.setGatewayState({ state: "error", error: detail });
          publishRuntimeStatus({
            phase: "error",
            message: "Gateway exited unexpectedly. The Web UI is still available.",
            logPath: this.logPath,
            error: detail,
          });
        }
        return;
      }
      if (!isQuitting && this.info && options.critical) {
        publishRuntimeStatus({
          phase: "error",
          message: `${name} exited unexpectedly. See runtime log for details.`,
          logPath: this.logPath,
          error: `${name} exited code=${code ?? "null"} signal=${signal ?? "null"}`,
        });
      }
    });
    return child;
  }

  private handleServerMessage(message: unknown): void {
    if (!message || typeof message !== "object" || !("type" in message)) return;
    const runtimeMessage = message as {
      type?: string;
      configuration?: ModelConfigurationState;
      id?: string;
      action?: string;
      value?: unknown;
    };
    if (runtimeMessage.type === 'pilotdeck:computer-use-request' && typeof runtimeMessage.id === 'string') {
      const reply = (status?: unknown, error?: string) => {
        if (this.serverProcess?.connected) this.serverProcess.send({ type: 'pilotdeck:computer-use-response', id: runtimeMessage.id, status, error }, () => {});
      };
      void (async () => {
        if (this.stopping || !this.computerUse) throw new Error('Computer use host is not ready');
        switch (runtimeMessage.action) {
          case 'status': return this.computerUse.status();
          case 'setEnabled': return this.computerUse.setEnabled(runtimeMessage.value);
          case 'refresh': return this.computerUse.refresh();
          case 'requestPermission': return this.computerUse.requestPermission(runtimeMessage.value);
          case 'revealPermissionApp': return this.computerUse.revealPermissionApp();
          default: throw new Error('Invalid computer use action');
        }
      })().then(status => reply(status), error => reply(undefined, String(error.message || error)));
      return;
    }
    if (runtimeMessage.type === "pilotdeck:configuration-state" && runtimeMessage.configuration) {
      this.configurationState = runtimeMessage.configuration;
      if (runtimeMessage.configuration.state === "ready") {
        void this.startGateway().catch(error => this.reportGatewayError(error));
      } else {
        void this.stopGateway().catch(error => this.reportGatewayError(error));
        publishRuntimeStatus({
          phase: "awaiting_configuration",
          message: runtimeMessage.configuration.state === "invalid"
            ? "Model configuration needs attention."
            : "PilotDeck is ready for model setup.",
          logPath: this.logPath,
        });
      }
      return;
    }
    if (runtimeMessage.type === "pilotdeck:retry-gateway" && this.configurationState?.state === "ready") {
      void this.stopGateway().then(() => this.startGateway()).catch(error => this.reportGatewayError(error));
    }
  }

  private startGateway(): Promise<void> {
    if (this.stopping || this.configurationState?.state !== "ready") return Promise.resolve();
    if (this.gatewayStopPromise) {
      return this.gatewayStopPromise.then(() => this.startGateway());
    }
    if (this.gatewayProcess && this.gatewayProcess.exitCode === null) return Promise.resolve();
    if (this.gatewayStartPromise) return this.gatewayStartPromise;

    this.gatewayStartPromise = this.launchGateway().finally(() => {
      this.gatewayStartPromise = null;
      if (
        this.configurationState?.state === "ready"
        && this.gatewayState.state === "stopped"
        && !this.gatewayProcess
      ) {
        void this.startGateway().catch(error => this.reportGatewayError(error));
      }
    });
    return this.gatewayStartPromise;
  }

  private async launchGateway(): Promise<void> {
    if (!this.commonEnv || !this.pilotHome || !this.gatewayPort) return;
    this.setGatewayState({ state: "starting" });
    publishRuntimeStatus({
      phase: "gateway",
      message: "Starting local gateway...",
      logPath: this.logPath,
    });

    let gateway: ChildProcess | null = null;
    try {
      // An exited gateway may still own descendants. Clear that group before
      // starting a replacement, just as we do before installing an update.
      for (const proc of [...this.processes].filter(proc => proc.name === "gateway")) {
        this.expectedExits.add(proc.child);
        await this.stopManagedProcess(proc.child);
      }
      if (this.stopping || this.configurationState?.state !== "ready") return;
      gateway = this.spawnRuntime(
        "gateway",
        this.gatewayCommand(),
        this.pilotHome,
        this.commonEnv,
      );
      this.gatewayProcess = gateway;
      await waitForPortOrProcessExit(
        gateway,
        "gateway",
        this.gatewayPort,
        "127.0.0.1",
        90_000,
        this.logPath,
      );
      if (this.gatewayProcess !== gateway) return;
      this.setGatewayState({ state: "ready" });
      publishRuntimeStatus({
        phase: "ready",
        message: "PilotDeck is ready.",
        logPath: this.logPath,
      });
    } catch (error) {
      if (gateway && this.gatewayProcess !== gateway) return;
      if (gateway && this.gatewayProcess === gateway) {
        this.expectedExits.add(gateway);
        try {
          await this.stopManagedProcess(gateway);
          this.gatewayProcess = null;
        } catch (stopError) { error = stopError; }
      }
      const detail = error instanceof Error ? error.message : String(error);
      this.log(`Gateway failed to start: ${detail}`);
      this.setGatewayState({ state: "error", error: detail });
      publishRuntimeStatus({
        phase: "error",
        message: "Gateway failed to start. The Web UI is still available.",
        logPath: this.logPath,
        error: detail,
      });
    }
  }

  private async stopGateway(): Promise<void> {
    if (this.gatewayStopPromise) return this.gatewayStopPromise;
    const gateway = this.gatewayProcess;
    this.gatewayStopPromise = (async () => {
      if (gateway) {
        this.expectedExits.add(gateway);
        await this.stopManagedProcess(gateway);
        this.gatewayProcess = null;
      }
      this.setGatewayState({ state: "stopped" });
    })().finally(() => {
      this.gatewayStopPromise = null;
    });
    return this.gatewayStopPromise;
  }

  private reportGatewayError(error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    this.log(`Gateway operation failed: ${detail}`);
    this.setGatewayState({ state: "error", error: detail });
  }

  private async stopManagedProcess(child: ChildProcess): Promise<void> {
    await killProcessTree(child);
    const index = this.processes.findIndex(proc => proc.child === child);
    if (index >= 0) this.processes.splice(index, 1);
  }

  private setGatewayState(state: GatewayRuntimeState): void {
    this.gatewayState = state;
    if (this.info) this.info.gateway = state;
    const server = this.serverProcess;
    if (!server || !server.connected) return;
    server.send({
      type: "pilotdeck:gateway-state",
      ...state,
    }, (error) => {
      if (error) this.log(`Failed to publish Gateway state: ${error.message}`);
    });
  }

  private logChunk(name: string, chunk: Buffer): void {
    const text = chunk.toString("utf8")
      .split(this.managedEnv?.PILOTDECK_MANAGED_TOKEN || '\0').join('[redacted]')
      .split(this.managedEnv?.PILOTDECK_MANAGED_LOCAL_KEY || '\0').join('[redacted]');
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) this.log(`[${name}] ${line}`);
    }
  }

  private log(message: string): void {
    const line = `${new Date().toISOString()} ${message}${os.EOL}`;
    this.logStream?.write(line);
    if (!app.isPackaged) process.stdout.write(line);
  }
}

async function ensureRuntime(): Promise<RuntimeInfo> {
  if (managedEnabled && (!managedAccounts?.current || isQuitting)) throw new Error('Online customer login is required.');
  if (runtime?.getInfo()) {
    return runtime.getInfo()!;
  }
  if (runtimeStartPromise) {
    return runtimeStartPromise;
  }
  if (managedEnabled && runtime) {
    throw new Error('The previous runtime has stopped or failed. Use Retry or Sign out to complete process cleanup.');
  }
  const runtimeRoot = resolveRuntimeRoot();
  const nodeBinary = resolveNodeBinary();
  const candidate = new RuntimeManager(runtimeRoot, nodeBinary,
    managedAccounts?.current ? managedRuntimeEnvironment(managedAccounts.current) : undefined);
  runtime = candidate;
  const pending = candidate.start().catch(async (error) => {
    await candidate.stop().catch(() => undefined);
    throw error;
  });
  runtimeStartPromise = pending;
  const clearPending = () => {
    if (runtimeStartPromise === pending) runtimeStartPromise = null;
  };
  void pending.then(clearPending, clearPending);
  return pending;
}

async function createOrShowWindow(): Promise<void> {
  if (isQuitting) return;
  if (managedEnabled && !managedAccounts?.current) {
    await showManagedLogin();
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (process.platform === "darwin") app.show();
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  const icon = resolveAppIcon();

  nativeTheme.themeSource = readAppearance().themeMode;
  desktopMenuState = { ...emptyMenuState };
  updateApplicationMenu();

  mainWindow = new BrowserWindow({
    ...windowChromeOptions(process.platform, nativeTheme.shouldUseDarkColors, readAppearance().lightAppearance),
    show: false,
    width: 1320,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: "PilotDeck",
    ...(icon ? { icon } : {}),
    // Windows and Linux show their application menus in the title-bar overlay.
    autoHideMenuBar: process.platform === "win32" || process.platform === "linux",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      ...(managedAccounts?.current ? { partition: managedAccounts.current.partition } : {}),
    },
  });

  const recoveryWindow = mainWindow;
  let allowInitialShow = true;
  const cancelInitialShow = () => { allowInitialShow = false; };
  recoveryWindow.once("close", cancelInitialShow);
  recoveryWindow.once("hide", cancelInitialShow);
  recoveryWindow.once("minimize", cancelInitialShow);
  recoveryWindow.once("ready-to-show", () => {
    recoveryWindow.off("close", cancelInitialShow);
    recoveryWindow.off("hide", cancelInitialShow);
    recoveryWindow.off("minimize", cancelInitialShow);
    if (!isQuitting && allowInitialShow) recoveryWindow.show();
  });
  // On Windows these events fire before isFullScreen() reflects the new state.
  recoveryWindow.on("enter-full-screen", () => setImmediate(publishWindowState));
  recoveryWindow.on("leave-full-screen", () => setImmediate(publishWindowState));
  recoveryWindow.webContents.on("did-start-navigation", (_event, _url, inPlace, isMainFrame) => {
    if (!isMainFrame || inPlace) return;
    desktopMenuState = { ...emptyMenuState };
    updateApplicationMenu();
  });
  recoveryWindow.webContents.on("render-process-gone", () => {
    desktopMenuState = { ...emptyMenuState };
    updateApplicationMenu();
  });
  recoveryWindow.webContents.on("before-input-event", (_event, input) => {
    // Native menu accelerators must not bypass focused editors' Find/Bold keys.
    recoveryWindow.webContents.setIgnoreMenuShortcuts(
      isRendererEditingShortcut(process.platform, input),
    );
  });
  lifecycle.attachWindow(recoveryWindow);
  // Windows logoff/shutdown does not go through app's normal quit events.
  // Respect the OS session end without displaying a quit confirmation.
  recoveryWindow.on("session-end", () => {
    isQuitting = true;
    desktopTray?.dispose();
  });
  installRendererRecovery(recoveryWindow, {
    isQuitting: () => isQuitting,
    isChinese: () => readAppearance().language === "zh-CN",
    showDialog: (options) => dialog.showMessageBox(recoveryWindow, options),
    log: (event, details) => {
      const line = `${new Date().toISOString()} [renderer] ${event} ${JSON.stringify(details)}\n`;
      void fs.promises.appendFile(path.join(app.getPath("logs"), "renderer.log"), line).catch(() => {});
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalNavigation(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (managedEnabled && new URL(url).origin !== updateOrigin) {
      event.preventDefault();
      openExternalNavigation(url);
      return;
    }
    if (!shouldOpenInSystemBrowser(url)) return;
    event.preventDefault();
    openExternalNavigation(url);
  });

  mainWindow.on("closed", () => {
    if (mainWindow === recoveryWindow) mainWindow = null;
    desktopMenuState = { ...emptyMenuState };
    updateApplicationMenu();
  });

  await mainWindow.webContents.session.clearCache();
  await mainWindow.loadURL(runtimeLoadingUrl());
  if (lastRuntimeStatus) {
    sendRuntimeStatus(lastRuntimeStatus);
  }
}

async function loadRuntimeUrl(info: RuntimeInfo): Promise<void> {
  if (isQuitting) return;
  updateOrigin = `http://127.0.0.1:${info.serverPort}`;
  if (!mainWindow || mainWindow.isDestroyed()) {
    await createOrShowWindow();
  }
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const entry = managedAccounts?.current && !managedAccounts.current.offline ? '/account' : '';
  await mainWindow.loadURL(`http://127.0.0.1:${info.serverPort}${entry}`);
}

function publishRuntimeStatus(status: RuntimeStatus): void {
  lastRuntimeStatus = status;
  sendRuntimeStatus(status);
}

function sendRuntimeStatus(status: RuntimeStatus): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("pilotdeck:runtime-status", status);
}

function shouldOpenInSystemBrowser(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  if (!EXTERNAL_NAVIGATION_PROTOCOLS.has(parsed.protocol)) {
    return false;
  }

  const info = runtime?.getInfo();
  const isLoopbackHost =
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "localhost" ||
    parsed.hostname === "[::1]" ||
    parsed.hostname === "::1";
  if (info && isLoopbackHost && parsed.port === String(info.serverPort)) {
    return false;
  }

  return true;
}

function openExternalNavigation(rawUrl: string): boolean {
  if (!shouldOpenInSystemBrowser(rawUrl)) {
    return false;
  }
  void shell.openExternal(rawUrl);
  return true;
}

async function startRuntimeAndLoad(): Promise<void> {
  if (isQuitting) return;
  if (managedEnabled && !managedAccounts?.current) return;
  try {
    const info = await ensureRuntime();
    await loadRuntimeUrl(info);
  } catch (error) {
    const detail = error instanceof Error ? error.stack ?? error.message : String(error);
    publishRuntimeStatus({
      phase: "error",
      message: "PilotDeck failed to start.",
      logPath: runtime?.getLogPath(),
      error: detail,
    });
  }
}

async function restoreMainWindow(): Promise<void> {
  if (managedEnabled && managedAccounts?.pending) {
    const owner = mainWindow ?? managedLoginWindow;
    if (owner && !owner.isDestroyed()) { owner.show(); owner.focus(); }
    return;
  }
  const needsWindow = !mainWindow || mainWindow.isDestroyed();
  await createOrShowWindow();
  // Restoring a hidden/minimized window must not reload the UI or restart tasks.
  if (needsWindow && !isQuitting) await startRuntimeAndLoad();
}

async function retryRuntime(): Promise<void> {
  if (isQuitting) return;
  if (managedEnabled && (!managedAccounts?.current || managedAccounts.pending)) throw new Error('Account is not ready.');
  const currentRuntime = runtime;
  await runtimeStartPromise?.catch(() => undefined);
  if (currentRuntime) await currentRuntime.stop();
  if (isQuitting) return;
  runtime = null;
  runtimeStartPromise = null;
  if (!mainWindow || mainWindow.isDestroyed()) {
    await createOrShowWindow();
  } else {
    await mainWindow.loadURL(runtimeLoadingUrl());
  }
  await startRuntimeAndLoad();
}


function resolveRuntimeRoot(): string {
  if (process.env.PILOTDECK_DESKTOP_RUNTIME_ROOT) {
    return path.resolve(process.env.PILOTDECK_DESKTOP_RUNTIME_ROOT);
  }
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "runtime");
  }
  return path.resolve(__dirname, "..", "..", "..");
}

function resolveNodeBinary(): string {
  if (process.env.PILOTDECK_DESKTOP_NODE) {
    return process.env.PILOTDECK_DESKTOP_NODE;
  }
  if (!app.isPackaged) {
    return process.platform === "win32" ? "node.exe" : "node";
  }
  const nodeRoot = path.join(process.resourcesPath, "node");
  const binary = process.platform === "win32"
    ? path.join(nodeRoot, "node.exe")
    : path.join(nodeRoot, "bin", "node");
  if (!fs.existsSync(binary)) {
    throw new Error(`Bundled Node runtime not found: ${binary}`);
  }
  return binary;
}

function resolveBundledGitPaths(): BundledGitPaths | undefined {
  if (process.platform !== "win32") {
    return undefined;
  }

  const configuredRoot = process.env.PILOTDECK_DESKTOP_GIT_ROOT
    ? path.resolve(process.env.PILOTDECK_DESKTOP_GIT_ROOT)
    : undefined;
  const root = configuredRoot
    ?? (app.isPackaged
      ? path.join(process.resourcesPath, "git")
      : path.resolve(__dirname, "..", "resources", "git"));
  const bash = path.join(root, "bin", "bash.exe");
  const git = path.join(root, "cmd", "git.exe");

  if (!fs.existsSync(bash) || !fs.existsSync(git)) {
    if (configuredRoot || app.isPackaged) {
      throw new Error(`Bundled Git Bash not found under ${root}`);
    }
    return undefined;
  }

  return {
    root,
    bash,
    git,
    pathEntries: [
      path.join(root, "cmd"),
      path.join(root, "bin"),
      path.join(root, "usr", "bin"),
      path.join(root, "mingw64", "bin"),
    ],
  };
}

function resolveAppIcon(): string | undefined {
  const fileName = process.platform === "win32" ? "icon.ico" : "icon.png";
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "icons", fileName)
    : path.resolve(__dirname, "..", "resources", "icons", fileName);
  return fs.existsSync(iconPath) ? iconPath : undefined;
}

function resolvePlaywrightBrowsersPath(runtimeRoot: string): string {
  if (hasBundledPlaywrightBrowser(runtimeRoot)) {
    return "0";
  }
  const browsersPath = path.join(desktopDataPath(), PLAYWRIGHT_BROWSER_DIR);
  fs.mkdirSync(browsersPath, { recursive: true });
  return browsersPath;
}

function hasBundledPlaywrightBrowser(runtimeRoot: string): boolean {
  const browsersRoot = path.join(runtimeRoot, "node_modules", "playwright-core", ".local-browsers");
  let entries: string[];
  try {
    entries = fs.readdirSync(browsersRoot);
  } catch {
    return false;
  }
  return entries.some((entry) => {
    if (!/^chromium(?:-|_)/u.test(entry)) return false;
    return fs.existsSync(path.join(browsersRoot, entry, "INSTALLATION_COMPLETE"));
  });
}

function getPathEnvKey(env: NodeJS.ProcessEnv): string {
  if (process.platform !== "win32") return "PATH";
  return Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "Path";
}

function withRuntimeCommandPath(
  env: NodeJS.ProcessEnv,
  runtimeRoot: string,
  nodeBinary: string,
  bundledGit?: BundledGitPaths,
): NodeJS.ProcessEnv {
  const pathKey = getPathEnvKey(env);
  const currentPath = env[pathKey] || "";
  const entries = [
    path.dirname(nodeBinary),
    ...(bundledGit?.pathEntries ?? []),
    path.join(runtimeRoot, "node_modules", ".bin"),
    currentPath,
  ].filter(Boolean);
  const nextEnv: NodeJS.ProcessEnv = {
    ...env,
    [pathKey]: entries.join(path.delimiter),
  };
  if (bundledGit) {
    nextEnv.PILOTDECK_GIT_BASH_PATH = bundledGit.bash;
    nextEnv.PILOTDECK_GIT_PATH = bundledGit.git;
    nextEnv.CHERE_INVOKING = nextEnv.CHERE_INVOKING || "1";
    nextEnv.MSYSTEM = nextEnv.MSYSTEM || "MINGW64";
  }
  return nextEnv;
}

function readBuildMetadata(): BuildMetadata {
  const metadataPath = app.isPackaged
    ? path.join(process.resourcesPath, "build-metadata.json")
    : path.resolve(__dirname, "..", "resources", "build-metadata.json");
  try {
    return JSON.parse(fs.readFileSync(metadataPath, "utf8")) as BuildMetadata;
  } catch {
    return {};
  }
}

function ensurePilotHome(log: (message: string) => void): { pilotHome: string } {
  const pilotHome = process.env.PILOT_HOME
    ? path.resolve(process.env.PILOT_HOME)
    : path.join(os.homedir(), ".pilotdeck");
  fs.mkdirSync(pilotHome, { recursive: true });
  log(`PilotDeck home ready at ${pilotHome}`);
  return { pilotHome };
}

function findFreePort(preferred: number, allowFallback = true): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => {
      if (!allowFallback) {
        reject(new Error(`Account port ${preferred} is in use. Close the conflicting application and retry; the saved account origin cannot change.`));
        return;
      }
      const fallback = 20000 + Math.floor(Math.random() * 40000);
      findFreePort(fallback).then(resolve, reject);
    });
    server.once("listening", () => {
      const address = server.address();
      server.close(() => {
        resolve(typeof address === "object" && address ? address.port : preferred);
      });
    });
    server.listen(preferred, "127.0.0.1");
  });
}

function waitForPort(port: number, host: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ host, port });
      socket.once("connect", () => {
        socket.end();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timed out waiting for ${host}:${port}`));
          return;
        }
        setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

function waitForPortOrProcessExit(
  child: ChildProcess,
  name: string,
  port: number,
  host: string,
  timeoutMs: number,
  logPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      child.off("managed-exit", onExit);
      callback();
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null, startupError?: string) => {
      finish(() => {
        reject(new Error(startupError || `${name} exited before it was ready (code=${code ?? "null"} signal=${signal ?? "null"}). See runtime log: ${logPath}`));
      });
    };
    child.once("managed-exit", onExit);
    waitForPort(port, host, timeoutMs)
      .then(() => finish(resolve))
      .catch((error) => finish(() => reject(error)));
  });
}

async function killProcessTree(child: ChildProcess): Promise<void> {
  const { stopProcessTree } = require(path.join(resolveRuntimeRoot(), "ui/server/utils/processTree.js"));
  await stopProcessTree(child);
}

let updateController: ReturnType<typeof createUpdateController> | ReturnType<typeof createManagedUpdates> | null = null;
function getUpdateController() {
  if (managedEnabled) {
    if (updateController) return updateController;
    const updateOwner = managedAccounts?.current;
    updateController = createManagedUpdates({
      version: app.getVersion(), packaged: app.isPackaged && process.platform === 'win32' && process.arch === 'x64',
      directory: path.join(app.getPath('userData'), 'managed-updates'),
      stillCurrent: () => Boolean(updateOwner && managedAccounts?.current === updateOwner && !managedAccounts.pending),
      releases: async () => {
        const account = managedAccounts?.current;
        if (!account) throw new Error('Account service unavailable.');
        const response = await fetch(`${account.serviceOrigin}/api/platform/releases`, {
          headers: { Authorization: `Bearer ${account.token}` }, redirect: 'error', signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error('Update check failed.');
        return (await response.json() as { releases: unknown[] }).releases;
      },
      confirmInstall: async version => {
        if (!mainWindow) return false;
        const choice = await dialog.showMessageBox(mainWindow, { type: 'question',
          title: '安装客户端更新', message: `版本 ${version} 已下载并通过校验。`,
          detail: '安装会退出客户端并停止本机任务。请先完成正在进行的任务，再确认安装。',
          buttons: ['稍后安装', '退出并安装'], defaultId: 0, cancelId: 0 });
        return choice.response === 1;
      },
      install: async file => {
        await runtimeStartPromise?.catch(() => undefined);
        await runtime?.stop();
        runtime = null; runtimeStartPromise = null;
        const error = await shell.openPath(file);
        if (error) { await retryRuntime(); throw new Error('installFailed'); }
        isQuitting = true;
        app.quit();
      },
    });
    return updateController;
  }
  if (updateController) return updateController;
  // Node bundled with Electron supports require(ESM). Reuse the same release
  // discovery module as Web, from the packaged runtime outside app.asar.
  const releases = require(path.join(resolveRuntimeRoot(), "ui/server/services/releaseService.js"));
  const repository = releases.normalizeRepository(process.env.PILOTDECK_UPDATE_REPOSITORY || readBuildMetadata().repository || DEFAULT_UPDATE_REPOSITORY);
  const linuxPackageType = process.platform === "linux" && app.isPackaged
    ? fs.readFileSync(path.join(process.resourcesPath, "package-type"), "utf8").trim() : "deb";
  const updater = process.platform === "darwin" ? new MacUpdater()
    : process.platform === "win32" ? new NsisUpdater()
      : linuxPackageType === "rpm" ? new RpmUpdater() : new DebUpdater();
  // The updater launches NSIS without a directory-page choice. Pass the
  // executable's actual installed directory so custom paths survive upgrades.
  if (updater instanceof NsisUpdater && app.isPackaged) updater.installDirectory = path.dirname(app.getPath("exe"));
  const network = createUpdateNetwork(updater.netSession, () => {
    if (managedEnabled) return undefined;
    const configService = require(path.join(resolveRuntimeRoot(), "ui/server/services/pilotdeckConfig.js"));
    const record = configService.readPilotDeckConfigFile();
    if (record.parseError) throw new Error("Invalid PilotDeck proxy configuration");
    return record.config.proxy;
  });
  updater.on("login", network.login);
  const downloadControl = installUpdateDownloadControl(updater);
  updateController = createUpdateController({
    updater, downloadControl, repository, platform: process.platform, arch: process.arch,
    version: app.getVersion(), packaged: app.isPackaged, linuxPackageType,
    prepareNetwork: network.prepare,
    latestRelease: () => releases.getLatestRelease({ repository, fetchImpl: network.fetch }),
    compareVersions: releases.compareVersions,
    prepareToInstall: async () => {
      isQuitting = true;
      await runtimeStartPromise?.catch(() => undefined);
      const currentRuntime = runtime;
      await currentRuntime?.stop();
      runtime = null;
      runtimeStartPromise = null;
    },
    recoverRuntime: async () => {
      isQuitting = false;
      await retryRuntime();
    },
  });
  return updateController;
}

function requireUpdateSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {
  const frame = event.senderFrame;
  // Only our loaded application can start or cancel an update; never a child
  // frame or external page. Status remains available while runtime is stopping.
  if (!mainWindow || event.sender !== mainWindow.webContents || frame !== event.sender.mainFrame) throw new Error("Invalid update sender");
  const url = new URL(frame.url);
  if (!updateOrigin || url.origin !== updateOrigin) throw new Error("Invalid update origin");
}
const activeDesktopNotifications = new Set<Electron.Notification>();
function createNotifications() {
  const account = managedAccounts?.current;
  return createDesktopNotifications({
  platform: process.platform,
  supported: () => Notification.isSupported(),
  read: () => { try { return JSON.parse(fs.readFileSync(path.join(desktopDataPath(), 'notifications.json'), 'utf8')); } catch { return null; } },
  save: value => fs.writeFileSync(path.join(desktopDataPath(), 'notifications.json'), JSON.stringify(value)),
  create: payload => {
    const notification = new Notification(nativeNotificationOptions(process.platform, payload));
    activeDesktopNotifications.add(notification);
    notification.on('close', () => activeDesktopNotifications.delete(notification));
    return notification;
  },
  setBadge: count => app.setBadgeCount(count),
  setTrayBadge: count => desktopTray?.setNotificationCount(count),
  setOverlay: (bitmap, label) => mainWindow?.setOverlayIcon(bitmap ? nativeImage.createFromBitmap(bitmap, { width: 32, height: 32 }) : null, label),
  navigate: async data => {
    if (managedEnabled && (managedAccounts?.current !== account || managedAccounts?.pending)) return;
    await restoreMainWindow();
    if (managedEnabled && (managedAccounts?.current !== account || managedAccounts?.pending)) return;
    mainWindow?.webContents.send('pilotdeck:notification-navigate', data);
  },
  report: error => console.warn('Desktop notification:', error),
  });
}
let notifications = createNotifications();
ipcMain.handle('pilotdeck:notification-status', event => { requireUpdateSender(event); return notifications.status(); });
ipcMain.handle('pilotdeck:notification-preferences', (event, value) => { requireUpdateSender(event); return notifications.preferences(value); });
ipcMain.handle('pilotdeck:notification-show', (event, value) => { requireUpdateSender(event); return notifications.show(value); });
ipcMain.handle('pilotdeck:notification-badge', (event, value) => { requireUpdateSender(event); notifications.badge(value); });
ipcMain.handle('pilotdeck:notification-settings', async event => {
  requireUpdateSender(event);
  if (process.platform === 'darwin') {
    try { await shell.openExternal(`x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=${APP_ID}`); }
    catch { await shell.openExternal('x-apple.systempreferences:com.apple.preference.notifications'); }
    return true;
  }
  if (process.platform === 'win32') { await shell.openExternal('ms-settings:notifications'); return true; }
  if (process.platform === 'linux') {
    const kde = /kde/i.test(process.env.XDG_CURRENT_DESKTOP || '');
    return new Promise<boolean>(resolve => {
      const child = spawn(kde ? 'systemsettings' : 'gnome-control-center', [kde ? 'kcm_notifications' : 'notifications'], { stdio: 'ignore', detached: true });
      child.on('error', () => resolve(false));
      child.on('spawn', () => { child.unref(); resolve(true); });
    });
  }
  return false;
});
for (const [channel, action] of Object.entries({
  "pilotdeck:about-info": () => desktopAboutInfo(desktopAboutContext()),
  "pilotdeck:update-check": () => getUpdateController().check(),
  "pilotdeck:update-status": () => getUpdateController().status(),
  "pilotdeck:update-start": () => getUpdateController().start(),
  "pilotdeck:update-cancel": () => getUpdateController().cancel(),
  "pilotdeck:update-pause": () => getUpdateController().pause(),
  "pilotdeck:update-resume": () => getUpdateController().resume(),
})) {
  ipcMain.handle(channel, (event) => { requireUpdateSender(event); return action(); });
}

function readAppearance(): DesktopAppearance {
  const locale = app.isReady() ? app.getLocale() : 'en';
  try {
    return normalizeAppearance(JSON.parse(fs.readFileSync(path.join(desktopDataPath(), "appearance.json"), "utf8")), locale);
  } catch { return normalizeAppearance(null, locale); }
}

ipcMain.on("pilotdeck:get-appearance", (event) => {
  try {
    requireUpdateSender(event);
    event.returnValue = readAppearance();
  } catch {
    event.returnValue = null;
  }
});

function dispatchDesktopCommand(command: DesktopCommand): void {
  if (isQuitting || !commandEnabled(command, desktopMenuState) || !mainWindow || mainWindow.isDestroyed()) return;
  if (!mainWindow.isVisible()) {
    if (process.platform === "darwin") app.show();
    mainWindow.show();
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  mainWindow.webContents.send("pilotdeck:command", command);
}

function desktopAboutContext() {
  return { language: readAppearance().language, appVersion: app.getVersion(), metadata: readBuildMetadata(),
    platform: process.platform, arch: process.arch, osRelease: os.release(), versions: process.versions };
}

async function showDesktopAbout(owner: BrowserWindow): Promise<void> {
  await presentDesktopAbout(desktopAboutContext(), {
    showDialog: options => dialog.showMessageBox(owner, { ...options, icon: resolveAppIcon() }),
    copy: text => clipboard.writeText(text), openWebsite: url => shell.openExternal(url),
  });
}

function desktopMenuTemplate() {
  return buildApplicationMenu(process.platform, readAppearance().language,
    () => { void lifecycle.requestQuit(); }, {
      state: desktopMenuState, dispatch: dispatchDesktopCommand,
      help: action => {
        if (action === "version") {
          clipboard.writeText(desktopAboutInformation(desktopAboutContext()).versionInformation);
        } else if (action === "about") {
          if (mainWindow && !mainWindow.isDestroyed()) void showDesktopAbout(mainWindow).catch(error => console.error("Desktop about dialog failed", error));
        } else {
          const operation = action === "docs"
            ? shell.openExternal("https://pilotdeck.openbmb.cn/pilotdeck.github.io/docs/introduction")
            : action === "issues" ? shell.openExternal("https://github.com/OpenBMB/PilotDeck/issues")
              : shell.openPath(runtime?.getLogPath() || app.getPath("logs"));
          void operation.catch(error => console.error("Desktop help action failed", error));
        }
      },
    });
}

function updateApplicationMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(desktopMenuTemplate()));
  if ((process.platform === "win32" || process.platform === "linux") && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setMenuBarVisibility(false);
    if (process.platform === "linux") mainWindow.webContents.send("pilotdeck:application-menu-updated");
  }
}

function activateLinuxMenuRole(role: string, owner: BrowserWindow): void {
  const contents = owner.webContents;
  switch (role) {
    case "undo": contents.undo(); break;
    case "redo": contents.redo(); break;
    case "cut": contents.cut(); break;
    case "copy": contents.copy(); break;
    case "paste": contents.paste(); break;
    case "selectAll": contents.selectAll(); break;
    case "resetZoom": contents.setZoomLevel(0); break;
    case "zoomIn": contents.setZoomLevel(contents.getZoomLevel() + 1); break;
    case "zoomOut": contents.setZoomLevel(contents.getZoomLevel() - 1); break;
    case "togglefullscreen": owner.setFullScreen(!owner.isFullScreen()); break;
    case "reload": contents.reload(); break;
    case "close": owner.close(); break;
    case "quit": void lifecycle.requestQuit(); break;
    case "about": void showDesktopAbout(owner).catch(error => console.error("Desktop about dialog failed", error)); break;
  }
}

ipcMain.handle("pilotdeck:linux-menu-items", (event, id: unknown) => {
  requireCaptionSender(event);
  return process.platform === "linux" ? linuxCaptionEntries(desktopMenuTemplate(), id) : [];
});

ipcMain.handle("pilotdeck:linux-menu-activate", (event, request?: { id?: unknown; index?: unknown }) => {
  requireCaptionSender(event);
  if (process.platform !== "linux" || !mainWindow || mainWindow.isDestroyed()) return false;
  const item = linuxCaptionAction(desktopMenuTemplate(), request?.id, request?.index);
  if (!item) return false;
  if (item.role) activateLinuxMenuRole(item.role, mainWindow);
  else (item.click as (() => void) | undefined)?.();
  return true;
});

function publishWindowState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const dark = nativeTheme.shouldUseDarkColors;
  const fullscreen = mainWindow.isFullScreen();
  const palette = windowPalette(dark, process.platform, readAppearance().lightAppearance);
  mainWindow.setBackgroundColor(palette.background);
  // Updating the native overlay while fullscreen can restore the window frame.
  if ((process.platform === "win32" || process.platform === "linux") && !fullscreen) mainWindow.setTitleBarOverlay({
    color: palette.caption, symbolColor: palette.symbol, height: WINDOWS_CAPTION_HEIGHT,
  });
  mainWindow.webContents.send("pilotdeck:window-state", { dark, fullscreen, palette });
}

// Caption controls are also available in our startup data document, before the
// runtime origin exists. Application actions still require the runtime origin.
function requireCaptionSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== event.sender.mainFrame) {
    throw new Error("Invalid caption sender");
  }
  const url = new URL(event.senderFrame.url);
  if (managedEnabled && url.protocol === 'data:' && event.senderFrame.url !== managedStartupUrl) throw new Error('Invalid caption document');
  if (url.protocol !== "data:" && (!updateOrigin || url.origin !== updateOrigin)) throw new Error("Invalid caption origin");
}

ipcMain.on("pilotdeck:get-window-state", event => {
  try {
    requireCaptionSender(event);
    const dark = nativeTheme.shouldUseDarkColors;
    event.returnValue = { dark, fullscreen: mainWindow!.isFullScreen(), palette: windowPalette(dark, process.platform, readAppearance().lightAppearance) };
  } catch { event.returnValue = { dark: false, fullscreen: false }; }
});
ipcMain.handle("pilotdeck:menu-state", (event, state: unknown) => {
  requireUpdateSender(event);
  const next = normalizeMenuState(state);
  if (JSON.stringify(next) === JSON.stringify(desktopMenuState)) return;
  desktopMenuState = next;
  updateApplicationMenu();
});
const captionMenus = new WeakMap<BrowserWindow, WindowsCaptionMenu>();
ipcMain.handle("pilotdeck:show-menu", (event, request?: CaptionMenuRequest) => {
  requireCaptionSender(event);
  if (process.platform !== "win32") return;
  const owner = mainWindow!;
  let menus = captionMenus.get(owner);
  if (!menus) {
    menus = new WindowsCaptionMenu(owner, desktopMenuTemplate, items => Menu.buildFromTemplate(items), () => screen.getCursorScreenPoint());
    captionMenus.set(owner, menus);
  }
  return menus.show(request);
});
nativeTheme.on("updated", publishWindowState);

ipcMain.handle("pilotdeck:set-appearance", (event, value: unknown) => {
  requireUpdateSender(event);
  const current = readAppearance();
  const appearance = saveAppearancePatch(desktopDataPath(), current, value, app.getLocale());
  if (current.themeMode !== appearance.themeMode) nativeTheme.themeSource = appearance.themeMode;
  const paletteChanged = JSON.stringify(windowPalette(nativeTheme.shouldUseDarkColors, process.platform, current.lightAppearance)) !== JSON.stringify(windowPalette(nativeTheme.shouldUseDarkColors, process.platform, appearance.lightAppearance));
  if (paletteChanged || current.themeMode !== appearance.themeMode) publishWindowState();
  if (current.language !== appearance.language) {
    updateApplicationMenu();
    desktopTray?.refreshMenu();
  }
});
ipcMain.handle('pilotdeck:appearance-capabilities', event => {
  requireUpdateSender(event);
  return { hardwareAcceleration: startupHardwareAcceleration };
});
ipcMain.handle('pilotdeck:save-appearance-image', (event, bytes: unknown) => {
  requireUpdateSender(event);
  return writeAppearanceImage(desktopDataPath(), bytes, buffer => nativeImage.createFromBuffer(buffer).getSize());
});
ipcMain.handle('pilotdeck:read-appearance-image', async (event, id: unknown) => {
  requireUpdateSender(event);
  const file = appearanceImagePath(desktopDataPath(), id);
  if ((await fs.promises.stat(file)).size > 10 * 1024 * 1024) throw new Error('Invalid background image');
  return new Uint8Array(await fs.promises.readFile(file));
});
ipcMain.handle('pilotdeck:delete-appearance-image', (event, id: unknown) => {
  requireUpdateSender(event);
  // Never remove an image referenced by the last successfully saved configuration.
  if (readAppearance().lightAppearance?.background.imageId === id) return;
  fs.rmSync(appearanceImagePath(desktopDataPath(), id), { force: true });
});

ipcMain.handle("pilotdeck:get-runtime-info", event => {
  if (managedEnabled) requireManagedRuntimeSender(event);
  return runtime?.getInfo();
});
ipcMain.handle("pilotdeck:retry-runtime", event => {
  if (!managedEnabled) return retryRuntime();
  requireManagedRuntimeSender(event);
  if (managedRuntimeRetry) return managedRuntimeRetry;
  const pending = retryRuntime();
  managedRuntimeRetry = pending;
  void pending.then(() => { managedRuntimeRetry = null; }, () => { managedRuntimeRetry = null; });
  return pending;
});
ipcMain.handle("pilotdeck:open-runtime-log", async event => {
  if (managedEnabled) requireManagedRuntimeSender(event);
  const logPath = runtime?.getLogPath() ?? lastRuntimeStatus?.logPath;
  if (logPath) {
    await shell.openPath(logPath);
  }
});
ipcMain.handle("pilotdeck:pick-folder", async event => {
  if (managedEnabled) requireManagedRuntimeSender(event);
  const owner = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined;
  const result = owner
    ? await dialog.showOpenDialog(owner, { properties: ["openDirectory", "createDirectory"] })
    : await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
  return result.canceled ? null : result.filePaths[0] ?? null;
});

const pickFiles = createFilePicker({
  defaults: { images: app.getPath('pictures'), files: app.getPath('downloads'), directory: app.getPath('home') },
  chinese: () => readAppearance().language === 'zh-CN',
  showDialog: (owner, options) => dialog.showOpenDialog(owner, options),
});
ipcMain.handle('pilotdeck:pick-files', (event, request: unknown) => {
  requireUpdateSender(event);
  return pickFiles(mainWindow!, request);
});

if (process.platform === "win32") {
  app.setAppUserModelId(APP_ID);
}

const lifecycle = createDesktopLifecycle({
  platform: process.platform,
  shouldConfirm: () => app.isReady() && (process.platform === "darwin" || process.platform === "win32"
    || (process.platform === "linux" && Boolean(mainWindow && !mainWindow.isDestroyed()))),
  canHide: () => process.platform === "darwin" || Boolean(desktopTray?.available()),
  isQuitting: () => isQuitting,
  setQuitting: value => { isQuitting = value; desktopTray?.setQuitting(value); },
  getWindow: () => mainWindow ?? managedLoginWindow,
  restoreWindow: restoreMainWindow,
  hideWindow: () => {
    // Hide the window explicitly: app.hide() on macOS leaves its isVisible()
    // state unchanged. Also hide the app to cover a native full-screen Space.
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
    if (managedLoginWindow && !managedLoginWindow.isDestroyed()) managedLoginWindow.hide();
    if (process.platform === "darwin") app.hide();
  },
  isChinese: () => readAppearance().language === "zh-CN",
  showDialog: (owner, options) => dialog.showMessageBox(owner, options),
  stopRuntime: async () => {
    await managedAccounts?.pending?.catch(() => undefined);
    await stopDesktopRuntime();
  },
  quit: () => app.quit(),
  reportError: error => console.error("PilotDeck lifecycle operation failed", error),
  reportStopError: error => dialog.showErrorBox(startupText("PilotDeck could not stop", readAppearance().language), String(error)),
});

const ownsInstance = process.platform === "darwin" || app.requestSingleInstanceLock();
if (!ownsInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    void restoreMainWindow().catch(error => console.error("Could not restore PilotDeck", error));
  });
  app.whenReady()
    .then(async () => {
      initializeManagedAccounts();
      if (process.platform === "win32" || process.platform === "darwin" || process.platform === "linux") {
        desktopTray = createDesktopTray({
          platform: process.platform,
          createTray: () => {
            if (process.platform === "darwin") {
              const iconPath = app.isPackaged
                ? path.join(process.resourcesPath, "icons", "trayTemplate.png")
                : path.resolve(__dirname, "..", "resources", "icons", "trayTemplate.png");
              const image = nativeImage.createFromPath(iconPath);
              if (image.isEmpty()) throw new Error("PilotDeck menu bar icon is missing");
              image.setTemplateImage(true);
              return new Tray(image);
            }
            const iconPath = resolveAppIcon();
            if (!iconPath) throw new Error("PilotDeck tray icon is missing");
            if (process.platform === "linux") {
              const image = nativeImage.createFromPath(iconPath).resize({ width: 24, height: 24 });
              if (image.isEmpty()) throw new Error("PilotDeck tray icon is invalid");
              return new Tray(image);
            }
            return new Tray(iconPath);
          },
          buildMenu: items => Menu.buildFromTemplate(items),
          ...(process.platform !== 'darwin' ? { notificationImage: (count: number) => {
            const base = nativeImage.createFromPath(resolveAppIcon()!).resize({ width: 32, height: 32 });
            if (!count) return base;
            const bitmap = base.toBitmap();
            const badge = nativeImage.createFromBitmap(badgeBitmap(count), { width: 32, height: 32 }).resize({ width: 20, height: 20 }).toBitmap();
            for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
              const source = (y * 20 + x) * 4;
              const target = (y * 32 + x + 12) * 4;
              const alpha = badge[source + 3] / 255;
              for (let channel = 0; channel < 3; channel++) bitmap[target + channel] = Math.round(badge[source + channel] * alpha + bitmap[target + channel] * (1 - alpha));
              bitmap[target + 3] = Math.max(bitmap[target + 3], badge[source + 3]);
            }
            return nativeImage.createFromBitmap(bitmap, { width: 32, height: 32 });
          } } : {}),
          isChinese: () => readAppearance().language === "zh-CN",
          open: lifecycle.open,
          requestQuit: lifecycle.requestQuit,
          reportError: error => console.error("PilotDeck tray operation failed", error),
        });
      }
      if (process.platform === "darwin") {
        // Shutdown is distinct from sleep: let the OS terminate without a prompt.
        powerMonitor.on("shutdown", (event?: Electron.Event) => {
          event?.preventDefault();
          void lifecycle.requestQuit(true);
        });
      }
      await createOrShowWindow();
    })
    .then(startRuntimeAndLoad)
    .catch(async (error) => {
      const detail = error instanceof Error ? error.stack ?? error.message : String(error);
      await runtime?.stop().catch(() => undefined);
      publishRuntimeStatus({
        phase: "error",
        message: "PilotDeck failed to start.",
        logPath: runtime?.getLogPath(),
        error: detail,
      });
      if (managedEnabled && !mainWindow && !managedLoginWindow) dialog.showErrorBox('PilotDeck could not start', detail);
      void lifecycle.requestQuit(true);
    });
}

app.on("window-all-closed", () => {
  if (managedEnabled && (managedWindowTransition || managedAccounts?.pending)) return;
  if (process.platform !== "darwin" && !desktopTray?.available() && !isQuitting) app.quit();
});

app.on("activate", () => {
  void lifecycle.open();
});

app.on("before-quit", event => lifecycle.beforeQuit(event));
app.on("will-quit", () => {
  lifecycle.dispose();
  desktopTray?.dispose();
});
