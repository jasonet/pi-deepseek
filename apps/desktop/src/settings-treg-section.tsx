import { useEffect, useState } from "react";
import type { WorkspaceRecord } from "./desktop-state";
import type { TregSettings, TregStatus } from "./ipc";
import { useT } from "./i18n";
import { SettingsGroup, SettingsInfoRow, SettingsRow } from "./settings-utils";

interface SettingsTregSectionProps {
  readonly workspaces: readonly WorkspaceRecord[];
}

export function SettingsTregSection({ workspaces }: SettingsTregSectionProps) {
  const t = useT();
  const api = window.piApp;
  const [status, setStatus] = useState<TregStatus>();
  const [draft, setDraft] = useState<TregSettings>();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = async () => {
    if (!api) return;
    setPending(true);
    setMessage("");
    try {
      const next = await api.getTregStatus();
      setStatus(next);
      setDraft(next.settings);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("settings.tools.refreshFailed"));
    } finally {
      setPending(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const update = (patch: Partial<TregSettings>) => {
    setDraft((current) => current ? { ...current, ...patch } : current);
  };

  const save = async () => {
    if (!api || !draft) return;
    setPending(true);
    setMessage("");
    try {
      const next = await api.saveTregSettings(draft);
      setStatus(next);
      setDraft(next.settings);
      setMessage(t("settings.tools.saved"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("settings.tools.saveFailed"));
    } finally {
      setPending(false);
    }
  };

  const installHarness = async () => {
    if (!api) return;
    setPending(true);
    setMessage("");
    try {
      const result = await api.installTregHarnessPlugin();
      setMessage(result.message);
      if (result.ok) await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("settings.tools.harnessFailed"));
    } finally {
      setPending(false);
    }
  };

  if (!draft) {
    return <SettingsGroup><SettingsInfoRow label={t("settings.tools.status")} value={pending ? t("common.loading") : t("settings.tools.unavailable")} /></SettingsGroup>;
  }

  const connection = !status?.tokenConfigured
    ? t("settings.tools.loginMissing")
    : status.connected
      ? t("settings.tools.connected")
      : status.message || t("settings.tools.loginDetected");

  return <>
    <SettingsGroup title={t("settings.tools.treg")} description={t("settings.tools.tregDesc")}>
      <SettingsRow title={t("settings.tools.enable")} description={t("settings.tools.enableDesc")}>
        <input aria-label={t("settings.tools.enable")} type="checkbox" checked={draft.enabled}
          onChange={(event) => update({ enabled: event.target.checked })} />
      </SettingsRow>
      <SettingsInfoRow label={t("settings.tools.status")} value={connection} />
      {status?.balanceUsd !== undefined ? (
        <SettingsInfoRow label={t("settings.tools.balance")} value={`$${status.balanceUsd.toFixed(6)}`} />
      ) : null}
      <SettingsRow title={t("settings.tools.serviceUrl")} description={t("settings.tools.serviceUrlDesc")}>
        <input className="settings-input" aria-label={t("settings.tools.serviceUrl")} value={draft.serviceUrl}
          onChange={(event) => update({ serviceUrl: event.target.value })} />
      </SettingsRow>
    </SettingsGroup>

    <SettingsGroup title={t("settings.tools.targets")} description={t("settings.tools.targetsDesc")}>
      <SettingsRow title="Pi" description={t("settings.tools.piDesc")}>
        <input aria-label="Pi" type="checkbox" checked={draft.piEnabled}
          onChange={(event) => update({ piEnabled: event.target.checked })} />
      </SettingsRow>
      <SettingsRow title="DeepSeek Harness" description={t("settings.tools.harnessDesc")}>
        <input aria-label="DeepSeek Harness" type="checkbox" checked={draft.harnessEnabled}
          onChange={(event) => update({ harnessEnabled: event.target.checked })} />
      </SettingsRow>
      {draft.harnessEnabled ? (
        <SettingsRow title={t("settings.tools.harnessPlugin")}
          description={status?.harnessInstalled ? t("settings.tools.harnessInstalled") : t("settings.tools.harnessNotInstalled")}>
          <button className="button button--secondary" type="button" disabled={pending || !status?.tokenConfigured}
            onClick={() => void installHarness()}>{t("settings.tools.installHarness")}</button>
        </SettingsRow>
      ) : null}
    </SettingsGroup>

    <SettingsGroup title={t("settings.tools.workspaces")} description={t("settings.tools.workspacesDesc")}>
      {workspaces.map((workspace) => {
        const checked = draft.workspaceRoots.includes(workspace.path);
        return <SettingsRow key={workspace.id} title={workspace.name} description={workspace.path}>
          <input aria-label={workspace.name} type="checkbox" checked={checked} onChange={(event) => update({
            workspaceRoots: event.target.checked
              ? [...draft.workspaceRoots, workspace.path]
              : draft.workspaceRoots.filter((root) => root !== workspace.path),
          })} />
        </SettingsRow>;
      })}
      {workspaces.length === 0 ? <SettingsInfoRow label={t("settings.tools.workspaces")} value={t("settings.tools.noWorkspaces")} /> : null}
    </SettingsGroup>

    <SettingsGroup title={t("settings.tools.safety")} description={t("settings.tools.safetyDesc")}>
      <SettingsRow title={t("settings.tools.paidCalls")} description={t("settings.tools.paidCallsDesc")}>
        <select className="settings-input" aria-label={t("settings.tools.paidCalls")} value={draft.paidCalls}
          onChange={(event) => update({ paidCalls: event.target.value as TregSettings["paidCalls"] })}>
          <option value="disabled">{t("settings.tools.disabled")}</option>
          <option value="ask">{t("settings.tools.askEveryTime")}</option>
        </select>
      </SettingsRow>
      <SettingsRow title={t("settings.tools.externalWrites")} description={t("settings.tools.externalWritesDesc")}>
        <input aria-label={t("settings.tools.externalWrites")} type="checkbox" checked={draft.allowMutatingCalls}
          onChange={(event) => update({ allowMutatingCalls: event.target.checked })} />
      </SettingsRow>
    </SettingsGroup>

    <div className="extension-dialog__actions">
      <button className="button button--secondary" type="button" onClick={() => void api?.openExternal("https://treg.to")}>
        {t("settings.tools.openTreg")}
      </button>
      <button className="button button--secondary" type="button" disabled={pending} onClick={() => void refresh()}>
        {t("settings.tools.refresh")}
      </button>
      <button className="button button--primary" type="button" disabled={pending} onClick={() => void save()}>
        {pending ? t("settings.tools.saving") : t("settings.tools.save")}
      </button>
    </div>
    {message ? <p className="settings-section__description" role="status">{message}</p> : null}
  </>;
}
