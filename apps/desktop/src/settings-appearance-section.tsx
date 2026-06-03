import type { ThemeMode } from "./desktop-state";
import { LOCALE_LABELS, type Locale } from "./i18n";
import { SettingsGroup, SettingsRow } from "./settings-utils";
import { useT } from "./i18n";

interface SettingsAppearanceSectionProps {
  readonly themeMode: ThemeMode;
  readonly onSetThemeMode: (mode: ThemeMode) => void;
  readonly enableTransparency: boolean;
  readonly onSetEnableTransparency: (enabled: boolean) => void;
  readonly locale: string;
  readonly onSetLocale: (locale: string) => void;
}

const THEME_MODES: readonly ThemeMode[] = ["system", "light", "dark"];

export function SettingsAppearanceSection({
  themeMode, onSetThemeMode, enableTransparency, onSetEnableTransparency, locale, onSetLocale,
}: SettingsAppearanceSectionProps) {
  const t = useT();
  const themeLabels: Record<ThemeMode, { label: string; desc: string }> = {
    system: { label: t("settings.appearance.system"), desc: t("settings.appearance.systemDesc") },
    light: { label: t("settings.appearance.light"), desc: t("settings.appearance.lightDesc") },
    dark: { label: t("settings.appearance.dark"), desc: t("settings.appearance.darkDesc") },
  };

  return (
    <>
      <SettingsGroup title={t("settings.appearance.theme")}>
        {THEME_MODES.map((mode) => (
          <SettingsRow key={mode} title={themeLabels[mode].label} description={themeLabels[mode].desc}>
            <input checked={themeMode === mode} name="theme" type="radio"
              onChange={() => onSetThemeMode(mode)} />
          </SettingsRow>
        ))}
      </SettingsGroup>

      <SettingsGroup title={t("settings.appearance.language")}>
        <SettingsRow title={t("settings.appearance.language")} description={t("settings.appearance.languageDesc")}>
          <select aria-label={t("settings.appearance.language")} className="settings-select"
            value={locale} onChange={(e) => onSetLocale(e.target.value)}>
            {(Object.entries(LOCALE_LABELS) as [Locale, string][]).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t("settings.appearance.visuals")}>
        <SettingsRow title={t("settings.appearance.transparency")} description={t("settings.appearance.transparencyDesc")}>
          <input aria-label={t("settings.appearance.transparency")} type="checkbox"
            checked={enableTransparency} onChange={(e) => onSetEnableTransparency(e.currentTarget.checked)} />
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}
