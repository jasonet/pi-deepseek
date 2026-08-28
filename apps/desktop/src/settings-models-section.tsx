import { useState } from "react";
import type { RuntimeSettingsSnapshot, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import {
  filterModels,
  labelForThinking,
  settingsPill,
  SettingsGroup,
  SettingsRow,
  THINKING_LEVELS,
} from "./settings-utils";
import { useT } from "./i18n";
import {
  buildProviderBulkSelection,
  NO_ENABLED_MODELS_PATTERN,
  normalizeEnabledModelPatterns,
  runtimeModelPattern,
  type ModelBulkSelectionMode,
} from "./model-bulk-selection";

const MAX_ENABLED_MODEL_PILLS = 12;

interface SettingsModelsSectionProps {
  readonly runtime?: RuntimeSnapshot;
  readonly onSetDefaultModel: (provider: string, modelId: string) => void;
  readonly onSetThinkingLevel: (thinkingLevel: RuntimeSettingsSnapshot["defaultThinkingLevel"]) => void;
  readonly onSetScopedModelPatterns: (patterns: readonly string[]) => void;
}

export function SettingsModelsSection({
  runtime,
  onSetDefaultModel,
  onSetThinkingLevel,
  onSetScopedModelPatterns,
}: SettingsModelsSectionProps) {
  const t = useT();
  const [modelQuery, setModelQuery] = useState("");
  const [scopedQuery, setScopedQuery] = useState("");
  const [scopedEditorOpen, setScopedEditorOpen] = useState(false);
  const [allModelsOpen, setAllModelsOpen] = useState(false);

  const models = runtime?.models ?? [];
  const availableModels = models.filter((m) => m.available);

  const enabledPatterns = runtime?.settings.enabledModelPatterns ?? [];
  const allImplicitlyEnabled = enabledPatterns.length === 0;

  const activeScopedPatterns = allImplicitlyEnabled
    ? availableModels.map(runtimeModelPattern)
    : enabledPatterns;
  const activeScopedSet = new Set(activeScopedPatterns);

  const enabledAvailableModels = availableModels.filter((model) => {
    if (allImplicitlyEnabled) return true;
    return activeScopedSet.has(runtimeModelPattern(model));
  });
  const enabledAvailablePatterns = enabledAvailableModels.map(runtimeModelPattern);
  const displayedEnabledPatterns = enabledAvailablePatterns.slice(0, MAX_ENABLED_MODEL_PILLS);
  const hiddenEnabledPatternCount = enabledAvailablePatterns.length - displayedEnabledPatterns.length;

  const defaultProvider = runtime?.settings.defaultProvider;
  const defaultModelId = runtime?.settings.defaultModelId;
  const defaultIsEnabled =
    defaultProvider && defaultModelId
      ? enabledAvailableModels.some((m) => m.providerId === defaultProvider && m.modelId === defaultModelId)
      : false;

  const filteredModels = filterModels(models, modelQuery);
  const filteredScopedModels = filterModels(availableModels, scopedQuery);
  const hasOpenRouterModels = availableModels.some((model) => model.providerId === "openrouter");

  const togglePattern = (pattern: string, checked: boolean) => {
    const currentPatterns = activeScopedPatterns.filter((entry) => entry !== NO_ENABLED_MODELS_PATTERN);
    const newPatterns = checked
      ? [...currentPatterns, pattern]
      : currentPatterns.filter((entry) => entry !== pattern);
    onSetScopedModelPatterns(normalizeEnabledModelPatterns(newPatterns));
  };

  const applyOpenRouterSelection = (mode: ModelBulkSelectionMode) => {
    onSetScopedModelPatterns(buildProviderBulkSelection(
      availableModels,
      activeScopedPatterns,
      "openrouter",
      mode,
    ));
  };

  return (
    <>
      <SettingsGroup>
        <SettingsRow title={t("settings.models.defaultModel")} description={t("settings.models.defaultModelDesc")}>
          <select
            className="settings-select"
            value={
              defaultProvider && defaultModelId && defaultIsEnabled
                ? `${defaultProvider}:${defaultModelId}`
                : ""
            }
            onChange={(event) => {
              const [provider, ...modelParts] = event.target.value.split(":");
              const modelId = modelParts.join(":");
              if (provider && modelId) {
                onSetDefaultModel(provider, modelId);
              }
            }}
          >
            <option value="">{t("settings.models.chooseModel")}</option>
            {enabledAvailableModels.map((model) => (
              <option key={`${model.providerId}:${model.modelId}`} value={`${model.providerId}:${model.modelId}`}>
                {model.providerName} · {model.label}
              </option>
            ))}
          </select>
        </SettingsRow>
        <SettingsRow title={t("settings.models.reasoning")} description={t("settings.models.reasoningDesc")}>
          <div className="settings-pill-row">
            {THINKING_LEVELS.map((level) => (
              <button
                className={settingsPill(runtime?.settings.defaultThinkingLevel === level)}
                key={level}
                type="button"
                onClick={() => onSetThinkingLevel(level)}
              >
                {labelForThinking(level)}
              </button>
            ))}
          </div>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t("settings.models.enabledModels")} description={t("settings.models.enabledModelsDesc")}>
        <div className="settings-row">
          {enabledAvailablePatterns.length > 0 ? (
            <div className="settings-pill-row">
              {displayedEnabledPatterns.map((pattern) => (
                <span className={settingsPill(true)} key={pattern}>{pattern}</span>
              ))}
              {hiddenEnabledPatternCount > 0 ? (
                <span className="settings-hint">
                  {t("settings.models.moreEnabled", { count: String(hiddenEnabledPatternCount) })}
                </span>
              ) : null}
            </div>
          ) : (
            <span className="settings-hint">
              {availableModels.length === 0
                ? t("settings.models.noAvailableModels")
                : t("settings.models.noEnabledModels")}
            </span>
          )}
        </div>
        {allImplicitlyEnabled && availableModels.length > 0 ? (
          <div className="settings-row">
            <span className="settings-hint">{t("settings.models.allEnabledDefault")}</span>
          </div>
        ) : null}
        {!defaultIsEnabled && defaultProvider && defaultModelId ? (
          <div className="settings-row">
            <span className="settings-warning">
              {t("settings.models.defaultNotEnabled", { provider: defaultProvider, model: defaultModelId })}
            </span>
          </div>
        ) : null}
        <details
          className="settings-disclosure"
          open={scopedEditorOpen}
          onToggle={(event) => setScopedEditorOpen(event.currentTarget.open)}
        >
          <summary className="settings-disclosure__summary">
            <span>{t("settings.models.editEnabled")}</span>
            <span>{filteredScopedModels.length}</span>
          </summary>
          {scopedEditorOpen ? <div className="settings-disclosure__body">
            <input
              aria-label={t("settings.models.searchEnabled")}
              className="settings-search"
              placeholder={t("settings.models.searchEnabled")}
              value={scopedQuery}
              onChange={(event) => setScopedQuery(event.target.value)}
            />
            {hasOpenRouterModels ? (
              <div className="settings-model-bulk-actions" role="group" aria-label={t("settings.models.openRouterActions")}>
                <span className="settings-model-bulk-actions__label">OpenRouter</span>
                <button type="button" onClick={() => applyOpenRouterSelection("none")}>
                  {t("settings.models.selectNone")}
                </button>
                <button type="button" onClick={() => applyOpenRouterSelection("all")}>
                  {t("settings.models.selectAll")}
                </button>
                <button type="button" onClick={() => applyOpenRouterSelection("smart")}>
                  {t("settings.models.smartSelect")}
                </button>
              </div>
            ) : null}
            <div className="settings-list">
              {filteredScopedModels.map((model) => {
                const pattern = runtimeModelPattern(model);
                const enabled = activeScopedSet.has(pattern);
                return (
                  <label className="settings-toggle settings-toggle--row" key={pattern}>
                    <input
                      checked={enabled}
                      type="checkbox"
                      onChange={(event) => togglePattern(pattern, event.target.checked)}
                    />
                    <span>
                      <strong>{model.providerName}</strong> · {model.label}
                      <span className="settings-list__meta"> · {pattern}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div> : null}
        </details>
      </SettingsGroup>

      <SettingsGroup title={t("settings.models.allModels")} description={t("settings.models.allModelsDesc")}>
        <details
          className="settings-disclosure"
          open={allModelsOpen}
          onToggle={(event) => setAllModelsOpen(event.currentTarget.open)}
        >
          <summary className="settings-disclosure__summary">
            <span>{t("settings.models.browseAll")}</span>
            <span>{filteredModels.length}</span>
          </summary>
          {allModelsOpen ? <div className="settings-disclosure__body">
            <input
              aria-label={t("settings.models.searchModels")}
              className="settings-search"
              placeholder={t("settings.models.searchModels")}
              value={modelQuery}
              onChange={(event) => setModelQuery(event.target.value)}
            />
            <div className="settings-list">
              {filteredModels.map((model) => {
                const pattern = runtimeModelPattern(model);
                const enabled = activeScopedSet.has(pattern);
                return (
                  <div className="settings-option" key={`${model.providerId}:${model.modelId}`}>
                    <span className="settings-option__title">{model.providerName} · {model.label}</span>
                    <span className="settings-option__meta">
                      {model.providerId}:{model.modelId}
                      {model.reasoning ? " · reasoning" : ""}
                      {model.supportsImages ? " · images" : ""}
                      {!model.available ? " · not logged in" : ""}
                    </span>
                    {model.available ? (
                      <label className="settings-toggle settings-toggle--inline">
                        <input
                          checked={enabled}
                          type="checkbox"
                          onChange={(event) => togglePattern(pattern, event.target.checked)}
                        />
                        <span className="sr-only">Enable</span>
                      </label>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div> : null}
        </details>
      </SettingsGroup>
    </>
  );
}
