import type { DesktopSystemPermissionsState, DesktopSystemPermissionStatus } from "./ipc";
import { SettingsGroup, SettingsRow } from "./settings-utils";
import { useT } from "./i18n";

interface SettingsSystemPermissionsSectionProps {
  readonly systemPermissionsStatus: DesktopSystemPermissionsState;
  readonly systemPermissionsPending: boolean;
  readonly onRequestSystemPermission: (type?: "accessibility" | "screenRecording" | "all") => void;
  readonly onOpenSystemPermissionSettings: (type: "accessibility" | "screenRecording") => void;
}

export function SettingsSystemPermissionsSection({
  systemPermissionsStatus,
  systemPermissionsPending,
  onRequestSystemPermission,
  onOpenSystemPermissionSettings,
}: SettingsSystemPermissionsSectionProps) {
  const t = useT();
  const isMac = navigator.platform.toUpperCase().includes("MAC");
  if (!isMac) {
    return null;
  }

  const axGranted = systemPermissionsStatus.accessibility === "granted";
  const screenGranted = systemPermissionsStatus.screenRecording === "granted";
  const allGranted = axGranted && screenGranted;

  return (
    <SettingsGroup
      title="桌面控制與系統權限 (Computer Use Permissions)"
      description="Computer Use 擴展需要 macOS 輔助功能（鍵鼠合成控制）與螢幕錄製（畫面視覺感知）權限以執行桌面自動化任務。"
    >
      <SettingsRow
        title="整體授權狀態"
        description={
          allGranted
            ? "所有必要權限均已啟用，Taosi 已具備完整的 Computer Use 桌面操作能力。"
            : "尚未開啟全部權限。點擊右側按鈕即可一鍵觸發系統授權彈窗與偏好設定引導。"
        }
      >
        <div className="settings-row__actions">
          <span className={`settings-pill ${allGranted ? "settings-pill--active" : ""}`}>
            {allGranted ? "✅ 權限齊備" : "⚠️ 待開啟"}
          </span>
          {!allGranted ? (
            <button
              className="button button--primary"
              disabled={systemPermissionsPending}
              type="button"
              onClick={() => onRequestSystemPermission("all")}
            >
              {systemPermissionsPending ? "正在請求授權…" : "⚡ 智能一鍵自動引導開啟"}
            </button>
          ) : null}
        </div>
      </SettingsRow>

      <SettingsRow
        title="輔助功能 (Accessibility)"
        description={descForStatus(systemPermissionsStatus.accessibility, "accessibility")}
      >
        <div className="settings-row__actions">
          <span className="settings-row__value">{labelForStatus(systemPermissionsStatus.accessibility)}</span>
          {!axGranted ? (
            <button
              className="button button--secondary"
              disabled={systemPermissionsPending}
              type="button"
              onClick={() => onRequestSystemPermission("accessibility")}
            >
              開啟輔助功能
            </button>
          ) : (
            <button
              className="button button--ghost"
              type="button"
              onClick={() => onOpenSystemPermissionSettings("accessibility")}
            >
              檢視系統設定
            </button>
          )}
        </div>
      </SettingsRow>

      <SettingsRow
        title="螢幕錄製 (Screen Recording)"
        description={descForStatus(systemPermissionsStatus.screenRecording, "screenRecording")}
      >
        <div className="settings-row__actions">
          <span className="settings-row__value">{labelForStatus(systemPermissionsStatus.screenRecording)}</span>
          {!screenGranted ? (
            <button
              className="button button--secondary"
              disabled={systemPermissionsPending}
              type="button"
              onClick={() => onRequestSystemPermission("screenRecording")}
            >
              開啟螢幕錄製
            </button>
          ) : (
            <button
              className="button button--ghost"
              type="button"
              onClick={() => onOpenSystemPermissionSettings("screenRecording")}
            >
              檢視系統設定
            </button>
          )}
        </div>
      </SettingsRow>

      <SettingsRow
        title="安全防護與全局急停 (Safety & Kill-Switch)"
        description="執行桌面操作期間，隨時可按鍵盤 Esc 鍵或點擊輸入框的「停止」按鈕中斷控制，應用程式會立即釋放鍵鼠鎖定並終止任務。"
      >
        <span className="settings-row__value">Esc 急停保護中</span>
      </SettingsRow>
    </SettingsGroup>
  );
}

function labelForStatus(status: DesktopSystemPermissionStatus): string {
  switch (status) {
    case "granted":
      return "✅ 已開啟";
    case "denied":
      return "❌ 未授權";
    case "default":
      return "⚠️ 尚未啟用";
    case "unsupported":
      return "不支援";
    default:
      return "檢查中…";
  }
}

function descForStatus(status: DesktopSystemPermissionStatus, kind: "accessibility" | "screenRecording"): string {
  if (kind === "accessibility") {
    switch (status) {
      case "granted":
        return "Taosi 擁有輔助功能權限，可精確合成點擊、打字與快捷鍵。";
      case "denied":
        return "尚未允許輔助功能。請在系統偏好設定中勾選 Taosi 或點擊按鈕一鍵引導。";
      default:
        return "需要輔助功能權限以在桌面應用中點擊元素與輸入文字。";
    }
  } else {
    switch (status) {
      case "granted":
        return "Taosi 擁有螢幕錄製權限，可擷取視窗畫面進行多模態視覺定位。";
      case "denied":
        return "尚未允許螢幕錄製。請在系統偏好設定中勾選 Taosi 或點擊按鈕一鍵引導。";
      default:
        return "需要螢幕錄製權限以擷取螢幕畫面與定位使用者介面按鈕。";
    }
  }
}
