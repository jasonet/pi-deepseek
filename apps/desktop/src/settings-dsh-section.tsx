import { useEffect, useState } from "react";
import type { DshOurFreeModelStatus, DshWebStatus } from "./ipc";
import { useT } from "./i18n";
import { SettingsGroup, SettingsInfoRow, SettingsRow } from "./settings-utils";

export function SettingsDshSection() {
  const t = useT();
  const api = window.piApp;
  const [status, setStatus] = useState<DshOurFreeModelStatus>();
  const [service, setService] = useState<DshWebStatus>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function refresh() {
    if (!api) return;
    const [plugin, dsh] = await Promise.all([
      api.getDshOurFreeModelStatus(),
      api.getDshWebStatus("harness"),
    ]);
    setStatus(plugin);
    setService(dsh);
  }

  useEffect(() => {
    void refresh().catch((cause) => setError(String(cause)));
  }, []);

  async function update(input: { enabled: boolean; mode: "auto" | "free" }) {
    if (!api) return;
    setPending(true);
    setError(undefined);
    try {
      setStatus(await api.setDshOurFreeModelConfig(input));
      setService(await api.getDshWebStatus("harness"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await refresh().catch(() => undefined);
    } finally {
      setPending(false);
    }
  }

  async function restart() {
    if (!api) return;
    setPending(true);
    setError(undefined);
    try {
      const next = await api.restartDshWeb("harness");
      setService(next);
      if (next.state === "error") setError(next.message);
      setStatus(await api.getDshOurFreeModelStatus());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }

  const serviceLabel = service?.state === "running"
    ? `${t("settings.dsh.running")} · 127.0.0.1:${service.port}`
    : service?.state === "error"
      ? service.message
      : service?.state === "installing" || service?.state === "launching" || service?.state === "starting"
        ? t("settings.dsh.starting")
        : t("settings.dsh.stopped");

  return (
    <div className="dsh-settings-section" data-testid="dsh-settings-section" aria-busy={pending}>
      <SettingsGroup title={t("settings.dsh.pluginTitle")} description={t("settings.dsh.pluginDescription")}>
        <SettingsInfoRow
          label={t("settings.dsh.package")}
          value={status?.installed
            ? `v${status.version ?? "?"}`
            : status?.available ? t("settings.dsh.ready") : t("settings.dsh.missing")}
        />
        <SettingsRow title={t("settings.dsh.enable")} description={t("settings.dsh.privacy")}>
          <label className="settings-toggle settings-toggle--inline">
            <input
              aria-label={t("settings.dsh.enable")}
              checked={status?.enabled ?? false}
              disabled={pending || (!status?.available && !status?.enabled)}
              type="checkbox"
              onChange={(event) => void update({ enabled: event.currentTarget.checked, mode: status?.mode ?? "auto" })}
            />
            <span>{status?.enabled ? t("settings.dsh.on") : t("settings.dsh.off")}</span>
          </label>
        </SettingsRow>
        <SettingsRow title={t("settings.dsh.mode")} description={t("settings.dsh.modeDescription")}>
          <div className="settings-segmented" role="radiogroup" aria-label={t("settings.dsh.mode")}>
            {(["auto", "free"] as const).map((mode) => (
              <button
                aria-checked={status?.mode === mode}
                className={status?.mode === mode ? "settings-segmented__option settings-segmented__option--active" : "settings-segmented__option"}
                disabled={pending || !status?.enabled}
                key={mode}
                onClick={() => { if (status?.mode !== mode) void update({ enabled: true, mode }); }}
                role="radio"
                type="button"
              >
                {t(mode === "auto" ? "settings.dsh.auto" : "settings.dsh.free")}
              </button>
            ))}
          </div>
        </SettingsRow>
        <SettingsInfoRow
          label={t("settings.dsh.effective")}
          value={t(`settings.dsh.route.${status?.effectiveDefault ?? "official"}`)}
        />
      </SettingsGroup>

      <SettingsGroup title={t("settings.dsh.service")} description={t("settings.dsh.serviceDescription")}>
        <SettingsInfoRow label={t("settings.harnesses.serviceStatus")} value={serviceLabel} />
        <SettingsRow title={t("settings.dsh.restart")} description={t("settings.dsh.restartDescription")}>
          <button className="button button--secondary" disabled={pending} onClick={() => void restart()} type="button">
            {t("settings.dsh.restart")}
          </button>
        </SettingsRow>
      </SettingsGroup>
      {error ? <p className="settings-help" role="alert">{error}</p> : null}
    </div>
  );
}
