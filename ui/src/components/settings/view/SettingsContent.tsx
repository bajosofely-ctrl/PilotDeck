import { lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from "react-i18next";
import { ChevronLeft } from "lucide-react";
import { useModelReferenceFocus } from '../shared/hooks/useModelReferenceFocus';
import { cn } from "../../../lib/utils";
import { useManaged } from '../../managed/ManagedContext';
const ManagedAccount = lazy(() => import('../../managed/AccountPage'));
import type { DesktopVersionCheckResult } from "../version";
import type { SettingsMenuKey } from "../types";
import type { SettingsProject } from "../shared/types";
import { SETTINGS_CONFIG_ICON } from "./navIcons";
const AgentMemorySections = lazy(() => import("./agentMemory"));
const AgentResidentSections = lazy(() => import("./agentResident"));
const AgentRouteSections = lazy(() => import("./agentRoute"));
const AgentScheduleSections = lazy(() => import("./agentSchedule"));
const AgentSearchSections = lazy(() => import("./agentSearch"));
const AdvancedSections = lazy(() => import("./advanced"));
const McpServersSection = lazy(() => import("./extensions"));
const GeneralSections = lazy(() => import("./general"));
const IntegrationsSections = lazy(() => import("./integrations"));
const ModelPoolSections = lazy(() => import("./modelPool"));
const UsageSections = lazy(() => import("./usage"));
const PrivacySections = lazy(() => import("./privacy"));
const AboutSections = lazy(() => import("./about"));
const OfficePreviewSections = lazy(() => import("./officePreview"));
const ComputerUseSections = lazy(() => import('./computerUse'));

const AppearanceSettings = lazy(() => import('./appearance'));

type SettingsContentProps = {
  selectedKey: SettingsMenuKey;
  projects: SettingsProject[];
  versionInfo: DesktopVersionCheckResult;
  checkingVersion: boolean;
  onCheckUpdates: () => Promise<void>;
  onCloseSettings?: () => void;
  mobileVisible?: boolean;
  onOpenMobileNavigation?: () => void;
};

const MENU_TITLE_KEYS: Record<SettingsMenuKey, string> = {
  general: "settingsPage.titles.general",
  appearance: "lightAppearance.title",
  modelPool: "settingsPage.titles.modelPool",
  usage: "settingsPage.titles.usage",
  agent: "settingsPage.titles.agent",
  agentRoute: "settingsPage.titles.agentRoute",
  agentMemory: "settingsPage.titles.agentMemory",
  agentResident: "settingsPage.titles.agentResident",
  agentSearch: "settingsPage.titles.agentSearch",
  agentSchedule: "settingsPage.titles.agentSchedule",
  integrations: "settingsPage.titles.integrations",
  extensions: "settingsPage.titles.extensions",
  mcpServers: "settingsPage.titles.mcpServers",
  officePreview: "settingsPage.titles.officePreview",
  computerUse: "settingsPage.titles.computerUse",
  privacy: "settingsPage.titles.privacy",
  advanced: "settingsPage.titles.advanced",
  about: "settingsPage.titles.about",
};

const PAGE_HEADING_KEYS: Record<SettingsMenuKey, string> = {
  general: "settingsPage.menu.general",
  appearance: "lightAppearance.title",
  modelPool: "settingsPage.menu.modelPool",
  usage: "settingsPage.menu.usage",
  agent: "settingsPage.menu.agent",
  agentRoute: "settingsPage.menu.agentRoute",
  agentMemory: "settingsPage.menu.agentMemory",
  agentResident: "settingsPage.menu.agentResident",
  agentSearch: "settingsPage.menu.agentSearch",
  agentSchedule: "settingsPage.menu.agentSchedule",
  integrations: "settingsPage.menu.messageChannels",
  extensions: "settingsPage.menu.extensions",
  mcpServers: "settingsPage.menu.mcpServers",
  officePreview: "settingsPage.menu.officePreview",
  computerUse: "settingsPage.menu.computerUse",
  privacy: "settingsPage.menu.privacy",
  advanced: "settingsPage.menu.system",
  about: "settingsPage.menu.about",
};

const PAGE_DESCRIPTION_KEYS: Partial<Record<SettingsMenuKey, string>> = {
  general: "settingsPage.descriptions.general",
  appearance: "lightAppearance.description",
  modelPool: "settingsPage.descriptions.modelPool",
  usage: "settingsPage.descriptions.usage",
  agentRoute: "settingsPage.descriptions.agentRoute",
  agentMemory: "settingsPage.descriptions.agentMemory",
  agentResident: "settingsPage.descriptions.agentResident",
  agentSearch: "settingsPage.descriptions.agentSearch",
  agentSchedule: "settingsPage.descriptions.agentSchedule",
  integrations: "settingsPage.descriptions.integrations",
  mcpServers: "settingsPage.descriptions.mcpServers",
  officePreview: "settingsPage.descriptions.officePreview",
  computerUse: "settingsPage.descriptions.computerUse",
  privacy: "settingsPage.descriptions.privacy",
  advanced: "settingsPage.descriptions.advanced",
  about: "settingsPage.descriptions.about",
};

const PAGE_CLASS: Partial<Record<SettingsMenuKey, string>> = {
  general: "general-settings-page",
  appearance: "appearance-settings-page",
  modelPool: "model-pool-page",
  usage: "usage-page",
  agentRoute: "agent-route-page",
  agentMemory: "agent-memory-page",
  agentResident: "agent-resident-page",
  agentSearch: "agent-search-page",
  agentSchedule: "agent-scheduled-page",
  integrations: "integration-settings-page",
  mcpServers: "mcp-settings-page",
  officePreview: "office-settings-page",
  computerUse: "computer-use-page",
  privacy: "security-settings-page",
  advanced: "advanced-settings-page",
  about: "about-settings-page",
};

export default function SettingsContent({
  selectedKey,
  projects,
  versionInfo,
  checkingVersion,
  onCheckUpdates,
  onCloseSettings,
  mobileVisible = true,
  onOpenMobileNavigation,
}: SettingsContentProps) {
  const { t } = useTranslation("settings");
  const managed = useManaged();
  const { search } = useLocation();
  const reference = new URLSearchParams(search).get('reference');
  useModelReferenceFocus(reference, selectedKey);
  const managedPages: Partial<Record<SettingsMenuKey, { heading: string; description: string }>> = {
    modelPool: { heading: "可用模型", description: "当前账户可使用的对话模型及价格。" },
    usage: { heading: "账户与账单", description: "查看余额、消费记录和登录设备。" },
    agentSearch: { heading: "搜索服务", description: "客户版搜索服务由管理员统一管理，此处为只读状态。" },
    advanced: { heading: "托管服务", description: "客户版连接与服务配置由管理员统一管理，此处为只读状态。" },
  };
  const managedPage = managed ? managedPages[selectedKey] : undefined;
  const title = managedPage?.heading ?? t(MENU_TITLE_KEYS[selectedKey]);
  const heading = managedPage?.heading ?? t(PAGE_HEADING_KEYS[selectedKey]);
  const descriptionKey = selectedKey === "about" && versionInfo.mode === "web"
    ? "settingsPage.descriptions.aboutWeb"
    : PAGE_DESCRIPTION_KEYS[selectedKey];
  const pageClass = managedPage ? undefined : PAGE_CLASS[selectedKey];
  const isAgentSubpage = selectedKey.startsWith("agent") && selectedKey !== "agent";
  const isExternalIntegrationPage =
    selectedKey === "integrations" ||
    selectedKey === "mcpServers" ||
    selectedKey === "officePreview" || selectedKey === 'computerUse';

  return (
    <div className={cn("settings-main", !mobileVisible && "mobile-hidden")}>
      <header className="topbar">
        <div className="topbar-title">
          <span
            className="topbar-config-icon"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: SETTINGS_CONFIG_ICON }}
          />
          <span>{t("settingsPage.breadcrumb")}</span>
          <span aria-hidden="true">›</span>
          {isAgentSubpage ? (
            <>
              <span>{t("settingsPage.menu.agent")}</span>
              <span aria-hidden="true">›</span>
            </>
          ) : null}
          {isExternalIntegrationPage ? (
            <>
              <span>{t("settingsPage.menu.integrations")}</span>
              <span aria-hidden="true">›</span>
            </>
          ) : null}
          <strong>{heading}</strong>
        </div>
      </header>

      <section key={selectedKey} className={cn("settings-page settings-content", pageClass)}>
        <button
          type="button"
          onClick={onOpenMobileNavigation}
          className="mobile-settings-back"
        >
          <ChevronLeft size={16} />
          {t("settingsPage.backToSettings")}
        </button>

        <header className={cn("page-header", selectedKey === "mcpServers" && "mcp-page-header")}>
          <div>
            <h1>{heading}</h1>
            {managedPage ? <p>{managedPage.description}</p> : descriptionKey ? <p>{t(descriptionKey)}</p> : null}
          </div>
        </header>

        <Suspense fallback={<div role="status" aria-busy="true">{t('lightAppearance.loading')}</div>}>
        {managed && (selectedKey === 'agentSearch' || selectedKey === 'advanced') ? (
          <section aria-label="服务配置状态" className="mt-6 border-t border-border pt-5 text-sm text-muted-foreground">
            <h2 className="mb-2 font-medium text-foreground">平台管理 · 只读</h2>
            <p>{selectedKey === 'agentSearch' ? '搜索服务的开通与调整请联系管理员。' : '如需调整账户权限或服务连接，请联系管理员。'}</p>
          </section>
        ) : managed && selectedKey === 'modelPool' ? (
          <ManagedAccount modelsOnly />
        ) : managed && selectedKey === 'usage' ? (
          <ManagedAccount />
        ) : selectedKey === "general" ? (
          <GeneralSections title={title} />
        ) : selectedKey === "appearance" ? (
          <AppearanceSettings />
        ) : selectedKey === "agentRoute" ? (
          <AgentRouteSections title={title} reference={reference} />
        ) : selectedKey === "agentMemory" ? (
          <AgentMemorySections title={title} projects={projects} />
        ) : selectedKey === "agentResident" ? (
          <AgentResidentSections title={title} projects={projects} />
        ) : selectedKey === "agentSearch" ? (
          <AgentSearchSections title={title} />
        ) : selectedKey === "agentSchedule" ? (
          <AgentScheduleSections title={title} />
        ) : selectedKey === "integrations" ? (
          <IntegrationsSections title={title} />
        ) : selectedKey === "mcpServers" ? (
          <McpServersSection title={title} projects={projects} />
        ) : selectedKey === "officePreview" ? (
          <OfficePreviewSections title={title} />
        ) : selectedKey === 'computerUse' ? (
          <ComputerUseSections />
        ) : selectedKey === "modelPool" ? (
          <ModelPoolSections title={title} />
        ) : selectedKey === "usage" ? (
          <UsageSections />
        ) : selectedKey === "privacy" ? (
          <PrivacySections title={title} />
        ) : selectedKey === "advanced" ? (
          <AdvancedSections title={title} />
        ) : selectedKey === "about" ? (
          <AboutSections
            title={title}
            versionInfo={versionInfo}
            checkingVersion={checkingVersion}
            onCheckUpdates={onCheckUpdates}
            onRestartConfirmed={onCloseSettings}
          />
        ) : (
          <div className="mt-6 flex min-h-[360px] flex-1 items-center justify-center rounded-xl border border-dashed border-border bg-muted/20">
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">
                {t("settingsPage.contentComingSoon.title")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("settingsPage.contentComingSoon.description")}
              </p>
            </div>
          </div>
        )}
        </Suspense>
      </section>
    </div>
  );
}
