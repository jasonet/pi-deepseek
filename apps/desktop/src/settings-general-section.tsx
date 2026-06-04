import { useT } from "./i18n";
import { useEffect, useState } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ModelSettingsScopeMode } from "./desktop-state";
import { SettingsGroup, SettingsInfoRow, SettingsRow } from "./settings-utils";

interface SettingsGeneralSectionProps {
  readonly runtime?: RuntimeSnapshot;
  readonly modelSettingsScopeMode: ModelSettingsScopeMode;
  readonly integratedTerminalShell: string;
  readonly onSetModelSettingsScopeMode: (mode: ModelSettingsScopeMode) => void;
  readonly onSetIntegratedTerminalShell: (shellPath: string) => void;
  readonly onToggleSkillCommands: (enabled: boolean) => void;
  readonly skipAutoTitle: boolean;
  readonly onSetSkipAutoTitle: (skip: boolean) => void;
}

export function SettingsGeneralSection({
  runtime,
  modelSettingsScopeMode,
  integratedTerminalShell,
  onSetModelSettingsScopeMode,
  onSetIntegratedTerminalShell,
  onToggleSkillCommands,
  skipAutoTitle,
  onSetSkipAutoTitle,
}: SettingsGeneralSectionProps) {
  const t = useT();
  const connectedCount = runtime?.providers.filter((p) => p.hasAuth).length ?? 0;
  const [terminalShellDraft, setTerminalShellDraft] = useState(integratedTerminalShell);

  useEffect(() => {
    setTerminalShellDraft(integratedTerminalShell);
  }, [integratedTerminalShell]);

  const commitTerminalShellDraft = () => {
    if (terminalShellDraft !== integratedTerminalShell) {
      onSetIntegratedTerminalShell(terminalShellDraft);
    }
  };

  return (
    <>
      <SettingsGroup title={t("settings.general")}>
        <SettingsInfoRow
          label={t("settings.general.connectedProviders")}
          value={connectedCount > 0 ? String(connectedCount) : t("settings.general.none")}
        />
        <SettingsInfoRow label={t("settings.general.discoveredSkills")} value={String(runtime?.skills.length ?? 0)} />
        <SettingsRow title={t("settings.general.modelSettingsScope")} description={t("settings.general.modelSettingsScopeDesc")}>
          <div className="settings-pill-row">
            <button
              className={`settings-pill${modelSettingsScopeMode === "app-global" ? " settings-pill--active" : ""}`}
              type="button"
              aria-pressed={modelSettingsScopeMode === "app-global"}
              onClick={() => onSetModelSettingsScopeMode("app-global")}
            >
              {t("settings.general.appGlobal")}
            </button>
            <button
              className={`settings-pill${modelSettingsScopeMode === "per-repo" ? " settings-pill--active" : ""}`}
              type="button"
              aria-pressed={modelSettingsScopeMode === "per-repo"}
              onClick={() => onSetModelSettingsScopeMode("per-repo")}
            >
              {t("settings.general.perRepo")}
            </button>
          </div>
        </SettingsRow>
        <SettingsRow title={t("settings.general.enableSkillCommands")} description={t("settings.general.enableSkillCommandsDesc")}>
          <input
            aria-label="Enable skill slash commands"
            checked={runtime?.settings.enableSkillCommands ?? true}
            type="checkbox"
            onChange={(event) => onToggleSkillCommands(event.target.checked)}
          />
        </SettingsRow>
        <SettingsRow title={t("settings.general.shellOfTerminal")} description={t("settings.general.shellOfTerminalDesc")}>
          <input
            aria-label={t("settings.general.shellOfTerminal")}
            className="settings-text-input"
            placeholder="/bin/zsh"
            spellCheck={false}
            type="text"
            value={terminalShellDraft}
            onBlur={commitTerminalShellDraft}
            onChange={(event) => setTerminalShellDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
          />
        </SettingsRow>
        <SettingsRow title={t("settings.general.skipAutoTitle")} description={t("settings.general.skipAutoTitleDesc")}>
          <input aria-label={t("settings.general.skipAutoTitle")} checked={skipAutoTitle} type="checkbox"
            onChange={(e) => onSetSkipAutoTitle(e.target.checked)} />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t("settings.general.shortcuts")}>
        <SettingsInfoRow label={t("settings.general.newThread")} value="Cmd+Shift+O" />
        <SettingsInfoRow label={t("settings.general.openSettings")} value="Cmd+," />
        <SettingsInfoRow label={t("settings.general.toggleTerminal")} value="Cmd+J" />
        <SettingsInfoRow label={t("settings.general.newTerminalTab")} value="Cmd+T" />
        <SettingsInfoRow label={t("settings.general.sendMessage")} value="Enter" />
        <SettingsInfoRow label={t("settings.general.newLine")} value="Shift+Enter" />
        <SettingsInfoRow label={t("settings.general.nextSession")} value="Cmd+Tab (Ctrl+Tab)" />
        <SettingsInfoRow label={t("settings.general.prevSession")} value="Cmd+Shift+Tab (Ctrl+Shift+Tab)" />
      </SettingsGroup>
    </>
  );
}
