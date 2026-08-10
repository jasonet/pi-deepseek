import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  RuntimeCustomModelProviderRecord,
  RuntimeCustomModelRecord,
  SaveRuntimeCustomModelProviderInput,
} from "@pi-gui/session-driver/runtime-types";
import { PlusIcon } from "./icons";
import { useT } from "./i18n";
import { SettingsGroup } from "./settings-utils";

interface SettingsCustomProvidersProps {
  readonly workspaceId?: string;
}

interface ProviderDraft {
  readonly editing: boolean;
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly models: readonly RuntimeCustomModelRecord[];
  readonly selectedModelIds: ReadonlySet<string>;
}

const EMPTY_DRAFT: ProviderDraft = {
  editing: false,
  id: "custom-local-openai",
  name: "Local OpenAI",
  baseUrl: "http://localhost:8080/v1",
  apiKey: "",
  models: [],
  selectedModelIds: new Set(),
};

export function SettingsCustomProviders({ workspaceId }: SettingsCustomProvidersProps) {
  const t = useT();
  const [providers, setProviders] = useState<readonly RuntimeCustomModelProviderRecord[]>([]);
  const [draft, setDraft] = useState<ProviderDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [manualModelId, setManualModelId] = useState("");

  const loadProviders = useCallback(async () => {
    const api = window.piApp;
    if (!api) return;
    setLoading(true);
    try {
      setProviders(await api.listCustomModelProviders());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const selectedModels = useMemo(
    () => draft?.models.filter((model) => draft.selectedModelIds.has(model.id)) ?? [],
    [draft],
  );

  const openCreate = () => {
    setDraft({ ...EMPTY_DRAFT, selectedModelIds: new Set() });
    resetFeedback();
  };

  const openEdit = (provider: RuntimeCustomModelProviderRecord) => {
    setDraft({
      editing: true,
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: "",
      models: provider.models,
      selectedModelIds: new Set(provider.models.map((model) => model.id)),
    });
    resetFeedback();
  };

  const updateDraft = (patch: Partial<ProviderDraft>) => {
    setDraft((current) => current ? { ...current, ...patch } : current);
  };

  const updateName = (name: string) => {
    setDraft((current) => {
      if (!current) return current;
      const id = current.editing ? current.id : customProviderIdFromName(name);
      return { ...current, name, id };
    });
  };

  const testConnection = async () => {
    if (!draft || !window.piApp) return;
    setPending(true);
    resetFeedback();
    const result = await window.piApp.probeCustomModelProvider({
      baseUrl: draft.baseUrl,
      ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
    });
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const existingModels = new Map(draft.models.map((model) => [model.id, model]));
    const discoveredModels = result.models.map((model) => {
      const existing = existingModels.get(model.id);
      return existing ? {
        ...model,
        reasoning: existing.reasoning || model.reasoning,
        supportsImages: existing.supportsImages || model.supportsImages,
      } : model;
    });
    updateDraft({
      models: discoveredModels,
      selectedModelIds: new Set(discoveredModels.map((model) => model.id)),
    });
    setStatus(result.message);
  };

  const addManualModel = () => {
    if (!draft) return;
    const id = manualModelId.trim();
    if (!id) return;
    const existing = draft.models.find((model) => model.id === id);
    const model = existing ?? {
      id,
      name: id,
      reasoning: false,
      supportsImages: false,
      contextWindow: 128_000,
      maxTokens: 16_384,
    };
    updateDraft({
      models: existing ? draft.models : [...draft.models, model],
      selectedModelIds: new Set([...draft.selectedModelIds, id]),
    });
    setManualModelId("");
  };

  const toggleModel = (modelId: string, selected: boolean) => {
    if (!draft) return;
    const next = new Set(draft.selectedModelIds);
    if (selected) next.add(modelId);
    else next.delete(modelId);
    updateDraft({ selectedModelIds: next });
  };

  const toggleModelCapability = (
    modelId: string,
    field: "reasoning" | "supportsImages",
    enabled: boolean,
  ) => {
    if (!draft) return;
    updateDraft({
      models: draft.models.map((model) => model.id === modelId ? { ...model, [field]: enabled } : model),
    });
  };

  const saveProvider = async () => {
    if (!draft || !workspaceId || !window.piApp) return;
    setPending(true);
    resetFeedback();
    const input: SaveRuntimeCustomModelProviderInput = {
      id: draft.id,
      name: draft.name,
      baseUrl: draft.baseUrl,
      ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
      models: selectedModels,
    };
    const nextState = await window.piApp.saveCustomModelProvider(workspaceId, input);
    setPending(false);
    if (nextState.lastError) {
      setError(nextState.lastError);
      return;
    }
    await loadProviders();
    setDraft(null);
  };

  const removeProvider = async (provider: RuntimeCustomModelProviderRecord) => {
    if (!workspaceId || !window.piApp) return;
    const confirmed = window.confirm(t("settings.providers.customRemoveConfirm", { provider: provider.name }));
    if (!confirmed) return;
    const nextState = await window.piApp.removeCustomModelProvider(workspaceId, provider.id);
    if (nextState.lastError) {
      setError(nextState.lastError);
      return;
    }
    await loadProviders();
  };

  const resetFeedback = () => {
    setStatus("");
    setError("");
  };

  return (
    <>
      <SettingsGroup
        title={t("settings.providers.custom")}
        description={t("settings.providers.customDesc")}
      >
        {loading ? (
          <div className="settings-row"><span className="settings-hint">{t("common.loading")}</span></div>
        ) : providers.length > 0 ? providers.map((provider) => (
          <div className="settings-row" key={provider.id} data-testid={`custom-provider-${provider.id}`}>
            <div className="settings-row__label">
              <div className="settings-row__title">{provider.name}</div>
              <div className="settings-row__description">
                {provider.baseUrl} · {provider.models.length} {t("settings.providers.customModels")}
              </div>
            </div>
            <div className="settings-row__control custom-provider__row-actions">
              <button className="button button--secondary" type="button" onClick={() => openEdit(provider)}>
                {t("common.edit")}
              </button>
              <button className="button button--secondary" type="button" onClick={() => void removeProvider(provider)}>
                {t("common.delete")}
              </button>
            </div>
          </div>
        )) : (
          <div className="settings-row">
            <span className="settings-row__description">{t("settings.providers.customEmpty")}</span>
          </div>
        )}
        <div className="settings-row">
          <div className="settings-row__label">
            <div className="settings-row__title">{t("settings.providers.customAdd")}</div>
            <div className="settings-row__description">{t("settings.providers.customAddDesc")}</div>
          </div>
          <div className="settings-row__control">
            <button className="button custom-provider__add" type="button" disabled={!workspaceId} onClick={openCreate}>
              <PlusIcon />
              <span>{t("settings.providers.customAddButton")}</span>
            </button>
          </div>
        </div>
      </SettingsGroup>

      {draft ? (
        <div className="extension-dialog-backdrop">
          <div className="extension-dialog custom-provider-dialog" data-testid="custom-provider-dialog">
            <div className="extension-dialog__title">
              {draft.editing ? t("settings.providers.customEditTitle") : t("settings.providers.customCreateTitle")}
            </div>
            <div className="custom-provider-dialog__fields">
              <label className="custom-provider-dialog__field">
                <span>{t("settings.providers.customName")}</span>
                <input
                  autoFocus
                  className="settings-search"
                  value={draft.name}
                  onChange={(event) => updateName(event.target.value)}
                />
              </label>
              <label className="custom-provider-dialog__field">
                <span>{t("settings.providers.customId")}</span>
                <input
                  className="settings-search"
                  disabled={draft.editing}
                  value={draft.id}
                  onChange={(event) => updateDraft({ id: event.target.value.toLowerCase() })}
                />
              </label>
              <label className="custom-provider-dialog__field custom-provider-dialog__field--wide">
                <span>{t("settings.providers.customBaseUrl")}</span>
                <input
                  className="settings-search"
                  placeholder="http://localhost:8080/v1"
                  value={draft.baseUrl}
                  onChange={(event) => updateDraft({ baseUrl: event.target.value })}
                />
              </label>
              <label className="custom-provider-dialog__field custom-provider-dialog__field--wide">
                <span>{t("settings.providers.customApiKey")}</span>
                <input
                  className="settings-search"
                  placeholder={draft.editing ? t("settings.providers.customApiKeyKeep") : t("settings.providers.customApiKeyOptional")}
                  type="password"
                  value={draft.apiKey}
                  onChange={(event) => updateDraft({ apiKey: event.target.value })}
                />
              </label>
            </div>

            <div className="custom-provider-dialog__probe-row">
              <button className="button button--secondary" disabled={pending || !draft.baseUrl.trim()} type="button" onClick={() => void testConnection()}>
                {pending ? t("settings.providers.customTesting") : t("settings.providers.customTest")}
              </button>
              {status ? <span className="custom-provider-dialog__status custom-provider-dialog__status--ok">{status}</span> : null}
            </div>

            <div className="custom-provider-dialog__models">
              <div className="custom-provider-dialog__models-header">
                <strong>{t("settings.providers.customDiscovered")}</strong>
                <span>{selectedModels.length}/{draft.models.length}</span>
              </div>
              {draft.models.length > 0 ? draft.models.map((model) => (
                <div className="custom-provider-dialog__model" key={model.id}>
                  <label className="settings-toggle settings-toggle--row">
                    <input
                      checked={draft.selectedModelIds.has(model.id)}
                      type="checkbox"
                      onChange={(event) => toggleModel(model.id, event.target.checked)}
                    />
                    <span><strong>{model.name}</strong><span className="settings-list__meta"> · {model.id}</span></span>
                  </label>
                  <div className="custom-provider-dialog__capabilities">
                    <label><input checked={model.reasoning} type="checkbox" onChange={(event) => toggleModelCapability(model.id, "reasoning", event.target.checked)} /> {t("settings.providers.customReasoning")}</label>
                    <label><input checked={model.supportsImages} type="checkbox" onChange={(event) => toggleModelCapability(model.id, "supportsImages", event.target.checked)} /> {t("settings.providers.customImages")}</label>
                  </div>
                </div>
              )) : <p className="extension-dialog__body">{t("settings.providers.customNoModels")}</p>}
              <div className="custom-provider-dialog__manual-model">
                <input
                  aria-label={t("settings.providers.customManualModel")}
                  className="settings-search"
                  placeholder={t("settings.providers.customManualModel")}
                  value={manualModelId}
                  onChange={(event) => setManualModelId(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addManualModel();
                    }
                  }}
                />
                <button className="button button--secondary" disabled={!manualModelId.trim()} type="button" onClick={addManualModel}>
                  {t("settings.providers.customAddModel")}
                </button>
              </div>
            </div>

            {error ? <p className="extension-dialog__body settings-warning">{error}</p> : null}
            <div className="extension-dialog__actions">
              <button className="button button--secondary" disabled={pending} type="button" onClick={() => setDraft(null)}>
                {t("common.cancel")}
              </button>
              <button
                className="button"
                disabled={pending || !draft.name.trim() || !draft.baseUrl.trim() || selectedModels.length === 0}
                type="button"
                onClick={() => void saveProvider()}
              >
                {t("common.save")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function customProviderIdFromName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `custom-${slug || "provider"}`;
}
