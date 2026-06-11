import type { RuntimeSettingsSnapshot, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ImChannel, ModelSettingsScopeMode, NotificationPreferences, SaveImChannelInput, WorkspaceRecord } from "./desktop-state";
import type { DesktopNotificationPermissionStatus } from "./ipc";
import { SettingsAppearanceSection } from "./settings-appearance-section";
import { SettingsChannelsSection } from "./settings-channels-section";
import { SettingsGeneralSection } from "./settings-general-section";
import { SettingsModelsSection } from "./settings-models-section";
import { SettingsNotificationsSection } from "./settings-notifications-section";
import { SettingsProvidersSection } from "./settings-providers-section";
import { type SettingsSection, sectionTitle, sectionDescription } from "./settings-utils";
import { useT } from "./i18n";

export type { SettingsSection } from "./settings-utils";

interface SettingsViewProps {
  readonly workspace?: WorkspaceRecord;
  readonly runtime?: RuntimeSnapshot;
  readonly section: SettingsSection;
  readonly notificationPreferences: NotificationPreferences;
  readonly imChannels: readonly ImChannel[];
  readonly notificationPermissionStatus: DesktopNotificationPermissionStatus;
  readonly notificationPermissionPending: boolean;
  readonly modelSettingsScopeMode: ModelSettingsScopeMode;
  readonly integratedTerminalShell: string;
  readonly themeMode: "system" | "light" | "dark";
  readonly enableTransparency: boolean;
  readonly locale: string;
  readonly autoUpdateEnabled: boolean;
  readonly skipAutoTitle: boolean;
  readonly onSetModelSettingsScopeMode: (mode: ModelSettingsScopeMode) => void;
  readonly onSetDefaultModel: (provider: string, modelId: string) => void;
  readonly onSetThinkingLevel: (thinkingLevel: RuntimeSettingsSnapshot["defaultThinkingLevel"]) => void;
  readonly onToggleSkillCommands: (enabled: boolean) => void;
  readonly onSetScopedModelPatterns: (patterns: readonly string[]) => void;
  readonly onLoginProvider: (providerId: string) => void;
  readonly onLogoutProvider: (providerId: string) => void;
  readonly onSetProviderApiKey: (providerId: string, apiKey: string) => Promise<string | undefined>;
  readonly onRemoveProviderApiKey: (providerId: string) => Promise<string | undefined>;
  readonly onSetNotificationPreferences: (preferences: Partial<NotificationPreferences>) => void;
  readonly onSaveImChannel: (input: SaveImChannelInput) => Promise<void>;
  readonly onRemoveImChannel: (channelId: string) => Promise<void>;
  readonly onSetIntegratedTerminalShell: (shellPath: string) => void;
  readonly onSetAutoUpdateEnabled: (enabled: boolean) => void;
  readonly onSetSkipAutoTitle: (enabled: boolean) => void;
  readonly onRequestNotificationPermission: () => void;
  readonly onOpenSystemNotificationSettings: () => void;
  readonly onSetThemeMode: (mode: "system" | "light" | "dark") => void;
  readonly onSetEnableTransparency: (enabled: boolean) => void;
  readonly onSetLocale: (locale: string) => void;
}

export function SettingsView({
  workspace,
  runtime,
  section,
  notificationPreferences,
  imChannels,
  notificationPermissionStatus,
  notificationPermissionPending,
  modelSettingsScopeMode,
  integratedTerminalShell,
  themeMode,
  enableTransparency,
  locale,
  autoUpdateEnabled,
  skipAutoTitle,
  onSetModelSettingsScopeMode,
  onSetDefaultModel,
  onSetThinkingLevel,
  onToggleSkillCommands,
  onSetScopedModelPatterns,
  onLoginProvider,
  onLogoutProvider,
  onSetProviderApiKey,
  onRemoveProviderApiKey,
  onSetNotificationPreferences,
  onSaveImChannel,
  onRemoveImChannel,
  onSetIntegratedTerminalShell,
  onSetAutoUpdateEnabled,
  onSetSkipAutoTitle,
  onRequestNotificationPermission,
  onOpenSystemNotificationSettings,
  onSetThemeMode,
  onSetEnableTransparency,
  onSetLocale,
}: SettingsViewProps) {
  const t = useT();

  if (!workspace && section !== "general" && section !== "channels" && section !== "notifications" && section !== "appearance") {
    return (
      <section className="canvas canvas--empty">
        <div className="empty-panel">
          <div className="session-header__eyebrow">{t("sidebar.settings")}</div>
          <h1>{t("common.selectWorkspace")}</h1>
          <p>Provider and skill settings need a selected workspace.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="canvas">
      <div className="conversation settings-view">
        <header className="view-header">
          <div>
            <div className="chat-header__eyebrow">{t("sidebar.settings")}</div>
            <h1 className="view-header__title">{sectionTitle(t, section)}</h1>
            <p className="view-header__body">
              {sectionDescription(t, section, workspace?.name ?? "this workspace")}
            </p>
          </div>
        </header>

        <div className="settings-grid">
          {section === "appearance" ? (
            <SettingsAppearanceSection
              themeMode={themeMode}
              onSetThemeMode={onSetThemeMode}
              enableTransparency={enableTransparency}
              onSetEnableTransparency={onSetEnableTransparency}
              locale={locale}
              onSetLocale={onSetLocale}
            />
          ) : null}

          {section === "general" ? (
            <SettingsGeneralSection
              runtime={runtime}
              modelSettingsScopeMode={modelSettingsScopeMode}
              integratedTerminalShell={integratedTerminalShell}
              onSetModelSettingsScopeMode={onSetModelSettingsScopeMode}
              onSetIntegratedTerminalShell={onSetIntegratedTerminalShell}
              onToggleSkillCommands={onToggleSkillCommands}
              skipAutoTitle={skipAutoTitle}
              onSetSkipAutoTitle={onSetSkipAutoTitle}
            />
          ) : null}

          {section === "providers" ? (
            <SettingsProvidersSection
              runtime={runtime}
              onLoginProvider={onLoginProvider}
              onLogoutProvider={onLogoutProvider}
              onSetProviderApiKey={onSetProviderApiKey}
              onRemoveProviderApiKey={onRemoveProviderApiKey}
            />
          ) : null}

          {section === "models" ? (
            <SettingsModelsSection
              runtime={runtime}
              onSetDefaultModel={onSetDefaultModel}
              onSetScopedModelPatterns={onSetScopedModelPatterns}
              onSetThinkingLevel={onSetThinkingLevel}
            />
          ) : null}

          {section === "channels" ? (
            <SettingsChannelsSection
              channels={imChannels}
              onSaveChannel={onSaveImChannel}
              onRemoveChannel={onRemoveImChannel}
            />
          ) : null}

          {section === "notifications" ? (
            <SettingsNotificationsSection
              notificationPreferences={notificationPreferences}
              notificationPermissionStatus={notificationPermissionStatus}
              notificationPermissionPending={notificationPermissionPending}
              onSetNotificationPreferences={onSetNotificationPreferences}
              onRequestNotificationPermission={onRequestNotificationPermission}
              onOpenSystemNotificationSettings={onOpenSystemNotificationSettings}
              autoUpdateEnabled={autoUpdateEnabled}
              onSetAutoUpdateEnabled={onSetAutoUpdateEnabled}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}
