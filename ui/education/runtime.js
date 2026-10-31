import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { managedChildEnvironment } from './managed.js';

const script = fileURLToPath(new URL('./server.js', import.meta.url));
const allowedEnvironment = new Set([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE', 'COMSPEC', 'TEMP', 'TMP',
]);

export function educationChildEnvironment(env) {
  return Object.fromEntries(Object.entries(env).filter(([name, value]) =>
    allowedEnvironment.has(name.toUpperCase()) && typeof value === 'string'));
}

const modules = {
  knowledge: { port: 3010, variable: 'PILOTDECK_EDUCATION_PORT' },
  'ai-literacy': { port: 3011, variable: 'PILOTDECK_AI_LESSONS_PORT' },
  'study-coach': { port: 3012, variable: 'PILOTDECK_STUDY_COACH_PORT' },
  'training-lab': { port: 3013, variable: 'PILOTDECK_TRAINING_LAB_PORT' },
  'ai-classroom': { port: 3015, variable: 'PILOTDECK_AI_CLASSROOM_PORT' },
};

export function createEducationRuntime({ env = process.env, moduleId = 'knowledge' } = {}) {
  const module = modules[moduleId];
  if (!module) throw new Error('Unknown education module.');
  let child = null;
  let pending = null;
  let state = { status: 'starting', message: '教育服务正在启动。' };
  let port = module.port;
  let stopping = false;

  function getStatus(hostname = 'localhost') {
    if (state.status !== 'ready') return { ...state };
    const host = hostname === '127.0.0.1' ? hostname : 'localhost';
    return { status: 'ready', url: `http://${host}:${port}/` };
  }

  function start({ parentPort } = {}) {
    if (pending) return pending;
    if (state.status === 'ready' && child) return Promise.resolve(getStatus());
    port = Number(env[module.variable] || module.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535 || port === parentPort) {
      state = { status: 'error', message: `教育端口必须是独立的有效端口，请检查 ${module.variable}。` };
      return Promise.resolve(getStatus());
    }
    let managedEnvironment;
    try {
      managedEnvironment = managedChildEnvironment(env, moduleId, parentPort);
    } catch {
      state = { status: 'error', message: '托管学习服务配置无效，请重新启动客户端。' };
      return Promise.resolve(getStatus());
    }
    if (child) child.kill();
    stopping = false;
    state = { status: 'starting', message: '教育服务正在启动。' };
    const parentPorts = [parentPort, Number(env.VITE_PORT || 5173)]
      .filter(value => Number.isInteger(value) && value > 0 && value <= 65535);
    const origins = [...new Set(parentPorts)].flatMap(value =>
      [`http://localhost:${value}`, `http://127.0.0.1:${value}`]);
    const active = spawn(process.execPath, [script], {
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      env: {
        ...educationChildEnvironment(env),
        ...managedEnvironment,
        NODE_ENV: 'production',
        PILOTDECK_EDUCATION_PORT: String(port),
        PILOTDECK_EDUCATION_MODULE: moduleId,
        PILOTDECK_EDUCATION_FRAME_ANCESTORS: origins.join(' '),
      },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      windowsHide: true,
    });
    child = active;
    pending = new Promise(resolve => {
      let settled = false;
      const finish = next => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        state = next;
        resolve(getStatus());
      };
      const fail = code => {
        finish({
          status: 'error',
          message: code === 'EADDRINUSE'
            ? `教育端口 ${port} 已被占用。请释放该端口后重试。`
            : '教育服务未能启动，请重试或查看服务日志。',
        });
      };
      const timer = setTimeout(() => {
        fail('TIMEOUT');
        active.kill();
      }, 8000);
      active.on('message', message => {
        if (message?.type === 'education:ready' && message.port === port) {
          finish({ status: 'ready' });
        } else if (message?.type === 'education:error') {
          fail(message.code);
        }
      });
      active.once('error', () => fail('SPAWN_FAILED'));
      active.once('exit', () => {
        if (child === active) {
          child = null;
          if (state.status === 'ready' && !stopping) {
            state = { status: 'error', message: '教育服务已停止，请重试。' };
          }
        }
        fail('EXITED');
      });
    }).finally(() => { pending = null; });
    return pending;
  }

  async function stop() {
    stopping = true;
    const active = child;
    child = null;
    if (active?.pid && active.exitCode === null && active.signalCode === null) {
      await new Promise(resolve => {
        const timer = setTimeout(() => active.kill('SIGKILL'), 1500);
        // On Windows an IPC child with inherited stdio can exit without a
        // subsequent 'close' event. 'exit' confirms the process was reaped.
        active.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        if (active.connected) active.disconnect();
        else active.kill();
      });
    }
    await pending;
    state = { status: 'starting', message: '教育服务已停止。' };
  }

  return { start, stop, getStatus };
}
