import type { DesktopNotificationPermissionStatus } from "./ipc";
import type { NotificationPreferences } from "./desktop-state";
import { SettingsGroup, SettingsRow } from "./settings-utils";
import { useT } from "./i18n";

interface SettingsNotificationsSectionProps {
  readonly notificationPreferences: NotificationPreferences;
  readonly notificationPermissionStatus: DesktopNotificationPermissionStatus;
  readonly notificationPermissionPending: boolean;
  readonly onSetNotificationPreferences: (preferences: Partial<NotificationPreferences>) => void;
  readonly onRequestNotificationPermission: () => void;
  readonly onOpenSystemNotificationSettings: () => void;
}

export function SettingsNotificationsSection({
  notificationPreferences,
  notificationPermissionStatus,
  notificationPermissionPending,
  onSetNotificationPreferences,
  onRequestNotificationPermission,
  onOpenSystemNotificationSettings,
}: SettingsNotificationsSectionProps) {
  const t = useT();
  const showAskMacOs = notificationPermissionStatus === "default";
  const showOpenSystemSettings = notificationPermissionStatus === "denied";
  const showRecoveryActions = showAskMacOs || showOpenSystemSettings;

  return (
    <>
      <SettingsGroup title={t("settings.notifications.permission")} description={t("settings.notifications.permissionDesc")}>
        <SettingsRow title={t("settings.notifications.permission")} description={descForPermissionStatus(notificationPermissionStatus)}>
          <span className="settings-row__value">{labelForPermissionStatus(notificationPermissionStatus)}</span>
        </SettingsRow>
        {showRecoveryActions ? (
          <SettingsRow
            title={t("settings.notifications.grantPermission")}
            description={
              showAskMacOs
                ? t("settings.notifications.permissionDefault")
                : t("settings.notifications.permissionDenied")
            }
          >
            <div className="settings-row__actions">
              {showAskMacOs ? (
                <button className="button button--secondary" disabled={notificationPermissionPending} type="button" onClick={onRequestNotificationPermission}>
                  {notificationPermissionPending ? t("settings.notifications.granting") : t("settings.notifications.grantPermission")}
                </button>
              ) : null}
              {showOpenSystemSettings ? (
                <button className="button button--secondary" disabled={notificationPermissionPending} type="button" onClick={onOpenSystemNotificationSettings}>
                  {t("settings.notifications.openSystemSettings")}
                </button>
              ) : null}
            </div>
          </SettingsRow>
        ) : null}
      </SettingsGroup>

      <SettingsGroup title={t("settings.notifications.backgroundEvents")} description={t("settings.notifications.backgroundEventsDesc")}>
        <SettingsRow title={t("settings.notifications.backgroundCompletion")} description={t("settings.notifications.backgroundCompletionDesc")}>
          <input aria-label={t("settings.notifications.backgroundCompletion")} checked={notificationPreferences.backgroundCompletion} type="checkbox"
            onChange={(event) => onSetNotificationPreferences({ backgroundCompletion: event.target.checked })} />
        </SettingsRow>
        <SettingsRow title={t("settings.notifications.backgroundFailure")} description={t("settings.notifications.backgroundFailureDesc")}>
          <input aria-label={t("settings.notifications.backgroundFailure")} checked={notificationPreferences.backgroundFailure} type="checkbox"
            onChange={(event) => onSetNotificationPreferences({ backgroundFailure: event.target.checked })} />
        </SettingsRow>
        <SettingsRow title={t("settings.notifications.attentionNeeded")} description={t("settings.notifications.attentionNeededDesc")}>
          <input aria-label={t("settings.notifications.attentionNeeded")} checked={notificationPreferences.attentionNeeded} type="checkbox"
            onChange={(event) => onSetNotificationPreferences({ attentionNeeded: event.target.checked })} />
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}

function labelForPermissionStatus(status: DesktopNotificationPermissionStatus): string {
  switch (status) {
    case "granted": return "Enabled";
    case "denied": return "Turned off";
    case "default": return "Not enabled yet";
    case "unsupported": return "Unavailable";
    default: return "Checking…";
  }
}

function descForPermissionStatus(status: DesktopNotificationPermissionStatus): string {
  switch (status) {
    case "granted": return "Pi-Deepseek has notification access.";
    case "denied": return "Notifications are blocked in System Settings.";
    case "default": return "Pi-Deepseek has not asked for notification access yet.";
    case "unsupported": return "Notifications are not supported on this system.";
    default: return "Checking notification status…";
  }
}
