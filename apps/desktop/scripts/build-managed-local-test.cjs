const { existsSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('Build this test installer on Windows x64.');
  }
  const desktopRoot = resolve(__dirname, '..');
  const repoRoot = resolve(desktopRoot, '../..');
  process.chdir(desktopRoot);
  const env = {
    ...process.env,
    PILOTDECK_DISTRIBUTION: 'managed-local-test',
    PILOTDECK_MANAGED_URL: 'http://127.0.0.1:3100',
    PILOTDECK_DESKTOP_NODE_ARCH: 'x64',
  };
  const archive = resolve(repoRoot, '.cache/runtime/node-v22.23.1-win-x64.zip');
  if (!env.PILOTDECK_DESKTOP_NODE_ARCHIVE && existsSync(archive)) {
    env.PILOTDECK_DESKTOP_NODE_ARCHIVE = archive;
  }
  for (const args of [
    [resolve(__dirname, 'build-runtime.mjs')],
    [require.resolve('typescript/bin/tsc'), '-p', resolve(desktopRoot, 'tsconfig.json')],
  ]) {
    const result = spawnSync(process.execPath, args, { cwd: desktopRoot, env, stdio: 'inherit', windowsHide: true });
    if (result.error || result.status !== 0) throw result.error || new Error(`Build failed: ${args[0]}`);
  }
  const { build, Platform, Arch } = require('electron-builder');
  await build({
    projectDir: desktopRoot,
    targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
    publish: 'never',
    config: {
      appId: 'cn.pilotdeck.desktop.localtest',
      productName: 'PilotDeck Local Test',
      extraMetadata: { name: 'pilotdeck-local-test', productName: 'PilotDeck Local Test' },
      directories: { output: 'dist-electron/local-test' },
      electronDist: resolve(desktopRoot, 'node_modules/electron/dist'),
      nsis: { perMachine: false, allowElevation: false },
    },
  });
}

main().catch(error => { console.error(error); process.exitCode = 1; });
