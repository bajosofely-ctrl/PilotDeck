import { useEffect, useState } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ArrowRight, BookOpen, FlaskConical, GraduationCap, MessagesSquare, Network, PanelLeftOpen, RefreshCw } from 'lucide-react';
import { authenticatedFetch } from '../../utils/api';
import './education.css';

const MODULES = [
  { id: 'knowledge', name: '中小学知识图谱与学习诊断', description: '数学 · 语文 · 英语 · 物理', icon: Network },
  { id: 'ai-literacy', name: 'AI 通识与实验', description: 'AI 入门 · 互动实验 · 提示词 · 创作', icon: BookOpen },
  { id: 'study-coach', name: 'AI 学习教练', description: '数学引导 · 阅读作文 · 英语 · 错题复习', icon: GraduationCap },
  { id: 'training-lab', name: 'AI 训练实验室', description: '采集样本 · 训练模型 · 识别实验', icon: FlaskConical },
  { id: 'ai-classroom', name: 'AI 使用小课堂', description: '学会提问 · 学习助手 · 写作创作 · 实战练习', icon: MessagesSquare },
] as const;
type EducationModuleDefinition = typeof MODULES[number];
const REQUEST_TIMEOUT_MS = 10_000;
const STATUS_INTERVAL_MS = 5_000;

type EducationPortalProps = {
  isSidebarCollapsed?: boolean;
  onOpenSidebar?: () => void;
};

type RuntimeState =
  | { status: 'loading' }
  | { status: 'ready'; url: string }
  | { status: 'starting' | 'error'; message: string };

function localModuleUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const hostPort = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
    if (
      url.protocol !== 'http:' ||
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      (url.port || '80') === hostPort ||
      url.origin === window.location.origin ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash
    ) return null;
    return url.href;
  } catch {
    return null;
  }
}

function EducationModule({
  isSidebarCollapsed,
  onOpenSidebar,
  onBack,
  module,
}: EducationPortalProps & { onBack: () => void; module: EducationModuleDefinition }) {
  const [attempt, setAttempt] = useState(0);
  const [runtime, setRuntime] = useState<RuntimeState>({ status: 'loading' });
  const [connectionWarning, setConnectionWarning] = useState(false);

  useEffect(() => {
    let controller: AbortController | undefined;
    let active = true;
    let timeout: number;
    let poll: number;

    async function loadRuntime(checkOnly = false) {
      const requestController = new AbortController();
      controller = requestController;
      let settled = false;
      const fail = (message: string) => {
        if (!active || settled) return;
        settled = true;
        if (checkOnly) {
          // A lost metadata request does not mean the learning page stopped.
          setConnectionWarning(true);
          poll = window.setTimeout(() => void loadRuntime(true), STATUS_INTERVAL_MS);
        } else {
          setRuntime({ status: 'error', message });
        }
      };
      const requestTimeout = window.setTimeout(() => {
        fail('连接教育服务超时，请稍后重试。');
        requestController.abort();
      }, REQUEST_TIMEOUT_MS);
      timeout = requestTimeout;
      try {
        const query = new URLSearchParams();
        if (module.id !== 'knowledge') query.set('module', module.id);
        if (checkOnly) query.set('check', '1');
        const response = await authenticatedFetch(`/education/runtime.json${query.size ? `?${query}` : ''}`, {
          signal: requestController.signal,
          cache: 'no-store',
          redirect: 'error',
          suppressServerErrorToast: true,
        });
        if (!active || settled) return;
        if (response.status === 401 || response.status === 403) {
          settled = true;
          setRuntime({ status: 'error', message: '登录状态已失效，请重新登录。' });
          return;
        }
        const data: unknown = await response.json();
        if (!active || settled) return;
        if (!data || typeof data !== 'object' || !('status' in data)) {
          throw new Error('Invalid education metadata');
        }
        if (response.status === 200 && data.status === 'ready') {
          settled = true;
          const url = localModuleUrl('url' in data ? data.url : undefined);
          if (!url) {
            setRuntime({ status: 'error', message: '教育服务地址无效，需使用独立端口的本机服务。' });
            return;
          }
          setConnectionWarning(false);
          setRuntime({ status: 'ready', url });
          // Browsers do not reliably emit iframe errors for failed navigation.
          // Check the child lifecycle without silently restarting a broken frame.
          poll = window.setTimeout(() => void loadRuntime(true), STATUS_INTERVAL_MS);
          return;
        }
        if (response.status === 503 && (data.status === 'starting' || data.status === 'error')) {
          settled = true;
          setRuntime({
            status: data.status,
            message: 'message' in data && typeof data.message === 'string' && data.message.trim()
              ? data.message
              : '教育服务暂不可用，请稍后重试。',
          });
          return;
        }
        throw new Error('Unexpected education response');
      } catch {
        fail('无法连接教育服务，请稍后重试。');
      } finally {
        window.clearTimeout(requestTimeout);
      }
    }
    void loadRuntime();
    return () => {
      active = false;
      window.clearTimeout(timeout);
      window.clearTimeout(poll);
      controller?.abort();
    };
  }, [attempt, module.id]);

  const reload = () => {
    setConnectionWarning(false);
    setRuntime({ status: 'loading' });
    setAttempt((previous) => previous + 1);
  };

  return (
    <div className="education-portal education-module" lang="zh-CN">
      <header className="workspace-header education-header education-module-header">
        {isSidebarCollapsed && (
          <button type="button" className="education-icon-button" onClick={onOpenSidebar} aria-label="展开侧栏" title="展开侧栏">
            <PanelLeftOpen aria-hidden="true" size={18} />
          </button>
        )}
        <button type="button" className="education-icon-button" onClick={onBack} aria-label="返回学习" title="返回学习">
          <ArrowLeft aria-hidden="true" size={18} />
        </button>
        <h1>{module.name}</h1>
        <div className="education-tools" aria-label="模块操作">
          <button
            type="button"
            className="education-icon-button"
            aria-label="重新加载"
            title="重新加载"
            onClick={reload}
            disabled={runtime.status === 'loading'}
          >
            <RefreshCw aria-hidden="true" size={18} />
          </button>
        </div>
      </header>
      {runtime.status === 'ready' && connectionWarning && (
        <div className="education-connection-warning" role="status">
          状态检查暂时失败，学习页面仍保留。正在自动重试。
        </div>
      )}
      <div className="education-module-content">
        {runtime.status === 'ready' ? (
          <>
            <span className="education-sr-only" role="status">教育服务已就绪</span>
            <iframe
              key={attempt}
              className="education-frame"
              title={module.name}
              src={runtime.url}
              allow={module.id === 'training-lab'
                ? 'camera; microphone; autoplay; clipboard-write' : 'clipboard-write'}
              sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="no-referrer"
              onError={() => setRuntime({ status: 'error', message: '学习模块加载失败，请重试。' })}
            />
          </>
        ) : (
          <section className="education-state" aria-label="教育服务状态">
            <div role={runtime.status === 'error' ? 'alert' : 'status'} aria-atomic="true">
              {runtime.status === 'error' && <AlertCircle aria-hidden="true" size={24} />}
              <h2>{runtime.status === 'loading' ? '正在连接教育服务' : runtime.status === 'starting' ? '教育服务正在启动' : '暂时无法打开学习模块'}</h2>
              {runtime.status !== 'loading' && <p>{runtime.message}</p>}
            </div>
            {runtime.status !== 'loading' && (
              <button type="button" className="education-retry" onClick={reload}>
                <RefreshCw aria-hidden="true" size={16} />重试
              </button>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

export default function EducationPortal(props: EducationPortalProps) {
  const navigate = useNavigate();
  const match = useMatch('/education/:moduleId');
  const selectedModule = MODULES.find(module => module.id === match?.params.moduleId);

  if (selectedModule) {
    return <EducationModule key={selectedModule.id} {...props} module={selectedModule} onBack={() => navigate('/education')} />;
  }

  return (
    <div className="education-portal education-module" lang="zh-CN">
      <header className="workspace-header education-header education-module-header">
        {props.isSidebarCollapsed && (
          <button type="button" className="education-icon-button" onClick={props.onOpenSidebar} aria-label="展开侧栏" title="展开侧栏">
            <PanelLeftOpen aria-hidden="true" size={18} />
          </button>
        )}
        <h1>学习</h1>
      </header>
      <section className="education-module-list" aria-label="学习模块">
        {MODULES.map(module => (
        <button
          key={module.id}
          type="button"
          className="education-module-button"
          onClick={() => navigate(`/education/${module.id}`)}
          aria-label={module.name}
        >
          <module.icon className="education-module-symbol" aria-hidden="true" size={28} />
          <span className="education-module-label">
            <strong>{module.name}</strong>
            <span>{module.description}</span>
          </span>
          <ArrowRight aria-hidden="true" size={18} />
        </button>
        ))}
      </section>
    </div>
  );
}
