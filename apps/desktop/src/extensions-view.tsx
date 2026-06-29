import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  RuntimeAppendSystemPrompt,
  RuntimeExtensionRecord,
  RuntimePackageRecord,
  RuntimePackageUpdate,
  RuntimeSnapshot,
} from "@pi-gui/session-driver/runtime-types";
import type { ExtensionCommandCompatibilityRecord, WorkspaceRecord } from "./desktop-state";
import { RefreshIcon } from "./icons";
import { useT } from "./i18n";
import { OpenDesignStatusBadge } from "./open-design-status";

interface ExtensionsViewProps {
  readonly workspace?: WorkspaceRecord;
  readonly runtime?: RuntimeSnapshot;
  readonly commandCompatibility?: readonly ExtensionCommandCompatibilityRecord[];
  readonly onRefresh: () => void;
  readonly onOpenExtensionFolder: (filePath: string) => void;
  readonly onToggleExtension: (filePath: string, enabled: boolean) => void;
  readonly onListPackages: () => Promise<readonly RuntimePackageRecord[]>;
  readonly onCheckForPackageUpdates: () => Promise<readonly RuntimePackageUpdate[]>;
  readonly onInstallPackage: (source: string) => Promise<void>;
  readonly onRemovePackage: (source: string) => Promise<void>;
  readonly onUpdatePackages: (source?: string) => Promise<void>;
  readonly onGetAppendSystemPrompt: () => Promise<RuntimeAppendSystemPrompt | null>;
  readonly onSetAppendSystemPrompt: (
    scope: "project" | "global",
    content: string,
  ) => Promise<RuntimeAppendSystemPrompt | null>;
}

export function ExtensionsView({
  workspace, runtime, commandCompatibility = [],
  onRefresh, onOpenExtensionFolder, onToggleExtension,
  onListPackages, onCheckForPackageUpdates, onInstallPackage, onRemovePackage, onUpdatePackages,
  onGetAppendSystemPrompt, onSetAppendSystemPrompt,
}: ExtensionsViewProps) {
  const t = useT();
  useEffect(() => { onRefresh(); }, []); // Auto-refresh on first open
  const [query, setQuery] = useState("");
  const [selectedExtensionPath, setSelectedExtensionPath] = useState<string | undefined>();
  const extensions = runtime?.extensions ?? [];
  const filteredExtensions = useMemo(() => {
    const n = query.trim().toLowerCase();
    if (!n) return extensions;
    return extensions.filter((ext) =>
      [ext.displayName, ext.path, ext.sourceInfo.source, ext.sourceInfo.scope, ext.sourceInfo.origin,
        ...ext.commands, ...ext.tools, ...ext.flags, ...ext.shortcuts,
        ...ext.diagnostics.map((d) => d.message),
      ].some((v) => v.toLowerCase().includes(n)),
    );
  }, [extensions, query]);
  const selectedExtension = filteredExtensions.find((e) => e.path === selectedExtensionPath) ?? filteredExtensions[0];
  const selectedCompat = useMemo(() =>
    selectedExtension ? commandCompatibility.filter((r) => r.extensionPath === selectedExtension.path).sort((a, b) => a.commandName.localeCompare(b.commandName)) : [],
    [commandCompatibility, selectedExtension]);

  if (!workspace) {
    return (
      <section className="canvas canvas--empty">
        <div className="empty-panel">
          <div className="session-header__eyebrow">{t("sidebar.extensions")}</div>
          <h1>{t("common.selectWorkspace")}</h1>
          <p>{t("extensions.noWorkspace")}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="canvas">
      <div className="conversation skills-view">
        <header className="view-header">
          <div>
            <div className="chat-header__eyebrow">{t("sidebar.extensions")}</div>
            <h1 className="view-header__title">{t("extensions.title")}</h1>
            <p className="view-header__body">{t("extensions.description", { workspace: workspace.name })}</p>
          </div>
          <div className="view-header__actions">
            <button className="button button--secondary" type="button" onClick={onRefresh}>
              <RefreshIcon /><span>{t("common.refresh")}</span>
            </button>
          </div>
        </header>

        <div className="skills-toolbar">
          <input aria-label={t("extensions.search")} className="skills-search" placeholder={t("extensions.search")}
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        <div className="skills-layout">
          <div className="skills-grid" data-testid="extensions-list">
            {filteredExtensions.length === 0 ? (
              <ExtensionsEmptyState message={t("extensions.refreshHint")} />
            ) : (
              filteredExtensions.map((ext) => (
                <button className={`skill-card ${selectedExtension?.path === ext.path ? "skill-card--active" : ""}`}
                  key={ext.path} type="button" onClick={() => setSelectedExtensionPath(ext.path)}>
                  <span className="skill-card__title-row">
                    <span className="skill-card__title">{ext.displayName}</span>
                    <span className={`skill-card__badge ${ext.enabled ? "skill-card__badge--enabled" : ""}`}>
                      {ext.enabled ? t("skills.enabled") : t("skills.disabled")}
                    </span>
                  </span>
                  <span className="skill-card__description">{ext.sourceInfo.scope} · {ext.sourceInfo.origin}</span>
                  <span className="skill-card__meta">
                    <span>{ext.sourceInfo.source}</span>
                    {ext.commands.length > 0 ? <span>{ext.commands.length} {t("extensions.commands")}</span> : null}
                    {ext.tools.length > 0 ? <span>{ext.tools.length} {t("extensions.tools")}</span> : null}
                    {ext.diagnostics.length > 0 ? <span>{ext.diagnostics.length} {t("extensions.issues")}</span> : null}
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="skill-detail">
            {selectedExtension ? (
              <>
                <div className="skill-detail__header">
                  <div><h2>{selectedExtension.displayName}</h2><div className="skill-detail__slash">{selectedExtension.sourceInfo.source}</div></div>
                  <span className={`skill-detail__status ${selectedExtension.enabled ? "skill-detail__status--enabled" : ""}`}>
                    {selectedExtension.enabled ? t("skills.enabled") : t("skills.disabled")}
                  </span>
                </div>
                <div className="skill-detail__meta-list">
                  <DetailItem label={t("extensions.scope")} value={selectedExtension.sourceInfo.scope} />
                  <DetailItem label={t("extensions.origin")} value={selectedExtension.sourceInfo.origin} />
                  <DetailItem label={t("skills.path")} value={selectedExtension.path} mono />
                  {selectedExtension.sourceInfo.baseDir ? (
                    <DetailItem label={t("extensions.baseDir")} value={selectedExtension.sourceInfo.baseDir} mono />
                  ) : null}
                </div>
                <div className="skill-detail__actions">
                  <button className="button button--secondary" type="button" onClick={() => onOpenExtensionFolder(selectedExtension.path)}>
                    {t("skills.openFolder")}
                  </button>
                  <button className="button button--secondary" type="button" onClick={() => onToggleExtension(selectedExtension.path, !selectedExtension.enabled)}>
                    {selectedExtension.enabled ? t("skills.disable") : t("skills.enable")}
                  </button>
                </div>
                {selectedExtension.displayName === "Open Design" ? <OpenDesignStatusBadge /> : null}
                <ExtensionContributionSection title={t("extensions.commands")} items={selectedExtension.commands} emptyLabel={t("extensions.noCommands")} />
                <ExtensionCompatibilitySection commands={selectedExtension.commands} compatibilityRecords={selectedCompat} t={t} />
                <ExtensionContributionSection title={t("extensions.tools")} items={selectedExtension.tools} emptyLabel={t("extensions.noTools")} />
                <ExtensionContributionSection title={t("extensions.flags")} items={selectedExtension.flags} emptyLabel={t("extensions.noFlags")} />
                <ExtensionContributionSection title={t("extensions.shortcuts")} items={selectedExtension.shortcuts} emptyLabel={t("extensions.noShortcuts")} />
                <ExtensionDiagnostics diagnostics={selectedExtension.diagnostics} t={t} />
              </>
            ) : (
              <ExtensionsEmptyState message={t("extensions.selectHint")} />
            )}
          </div>
        </div>

        <PackagesSection
          onListPackages={onListPackages}
          onCheckForPackageUpdates={onCheckForPackageUpdates}
          onInstallPackage={onInstallPackage}
          onRemovePackage={onRemovePackage}
          onUpdatePackages={onUpdatePackages}
        />

        <AppendSystemPromptSection
          onGetAppendSystemPrompt={onGetAppendSystemPrompt}
          onSetAppendSystemPrompt={onSetAppendSystemPrompt}
        />
      </div>
    </section>
  );
}

function PackagesSection({
  onListPackages, onCheckForPackageUpdates, onInstallPackage, onRemovePackage, onUpdatePackages,
}: {
  readonly onListPackages: () => Promise<readonly RuntimePackageRecord[]>;
  readonly onCheckForPackageUpdates: () => Promise<readonly RuntimePackageUpdate[]>;
  readonly onInstallPackage: (source: string) => Promise<void>;
  readonly onRemovePackage: (source: string) => Promise<void>;
  readonly onUpdatePackages: (source?: string) => Promise<void>;
}) {
  const t = useT();
  const [packages, setPackages] = useState<readonly RuntimePackageRecord[]>([]);
  const [updates, setUpdates] = useState<readonly RuntimePackageUpdate[]>([]);
  const [installSource, setInstallSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    try {
      setPackages(await onListPackages());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [onListPackages]);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    void (async () => {
      try {
        await fn();
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    })();
  };

  const handleCheck = () => run(async () => { setUpdates(await onCheckForPackageUpdates()); });
  const handleInstall = () => {
    const source = installSource.trim();
    if (!source) return;
    run(async () => { await onInstallPackage(source); setInstallSource(""); setUpdates([]); });
  };
  const handleUpdateAll = () => run(async () => { await onUpdatePackages(); setUpdates([]); });
  const handleUpdateOne = (source: string) => run(async () => { await onUpdatePackages(source); setUpdates([]); });
  const handleRemove = (source: string) => run(async () => { await onRemovePackage(source); setUpdates([]); });

  const updatable = useMemo(() => new Set(updates.map((u) => u.source)), [updates]);

  return (
    <div className="packages-section">
      <div className="packages-section__header">
        <div>
          <h2>{t("extensions.packages")}</h2>
          <p className="skill-detail__description">{t("extensions.packagesHint")}</p>
        </div>
        <div className="view-header__actions">
          <button className="button button--secondary" type="button" disabled={busy} onClick={handleCheck}>
            {t("extensions.checkUpdates")}
          </button>
          <button className="button button--secondary" type="button" disabled={busy || updates.length === 0} onClick={handleUpdateAll}>
            {t("extensions.updateAll")}
          </button>
        </div>
      </div>

      <div className="packages-section__install">
        <input
          aria-label={t("extensions.install")}
          className="skills-search"
          placeholder={t("extensions.installPlaceholder")}
          value={installSource}
          disabled={busy}
          onChange={(e) => setInstallSource(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleInstall(); }}
        />
        <button className="button" type="button" disabled={busy || installSource.trim().length === 0} onClick={handleInstall}>
          {t("extensions.install")}
        </button>
      </div>

      {busy ? <div className="skill-detail__description">{t("extensions.packageBusy")}</div> : null}
      {error ? <div className="activity-item activity-item--error"><div className="activity-item__text">{error}</div></div> : null}
      {updates.length > 0 ? (
        <div className="skill-detail__description">{t("extensions.updatesAvailable", { count: String(updates.length) })}</div>
      ) : null}

      {packages.length === 0 ? (
        <div className="skill-detail__description">{t("extensions.noPackages")}</div>
      ) : (
        <div className="packages-list">
          {packages.map((pkg) => (
            <div className="packages-row" key={`${pkg.scope}:${pkg.source}`}>
              <div className="packages-row__info">
                <span className="packages-row__source">{pkg.source}</span>
                <span className="skill-card__meta">
                  <span>{pkg.scope}</span>
                  {pkg.filtered ? <span>{t("extensions.packageFiltered")}</span> : null}
                  {updatable.has(pkg.source) ? <span className="slash-menu__skill-badge slash-menu__skill-badge--warning">{t("extensions.update")}</span> : null}
                </span>
              </div>
              <div className="packages-row__actions">
                {updatable.has(pkg.source) ? (
                  <button className="button button--secondary" type="button" disabled={busy} onClick={() => handleUpdateOne(pkg.source)}>
                    {t("extensions.update")}
                  </button>
                ) : null}
                <button className="button button--secondary" type="button" disabled={busy} onClick={() => handleRemove(pkg.source)}>
                  {t("extensions.remove")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AppendSystemPromptSection({
  onGetAppendSystemPrompt, onSetAppendSystemPrompt,
}: {
  readonly onGetAppendSystemPrompt: () => Promise<RuntimeAppendSystemPrompt | null>;
  readonly onSetAppendSystemPrompt: (
    scope: "project" | "global",
    content: string,
  ) => Promise<RuntimeAppendSystemPrompt | null>;
}) {
  const t = useT();
  const [data, setData] = useState<RuntimeAppendSystemPrompt | null>(null);
  const [projectDraft, setProjectDraft] = useState("");
  const [globalDraft, setGlobalDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const apply = useCallback((next: RuntimeAppendSystemPrompt | null) => {
    setData(next);
    setProjectDraft(next?.project.content ?? "");
    setGlobalDraft(next?.global.content ?? "");
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await onGetAppendSystemPrompt());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [apply, onGetAppendSystemPrompt]);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = (scope: "project" | "global", content: string) => {
    setBusy(true);
    setError(undefined);
    void (async () => {
      try {
        apply(await onSetAppendSystemPrompt(scope, content));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    })();
  };

  const scopes: ReadonlyArray<{
    readonly scope: "project" | "global";
    readonly label: string;
    readonly file: RuntimeAppendSystemPrompt["project"] | undefined;
    readonly draft: string;
    readonly setDraft: (value: string) => void;
  }> = [
    { scope: "project", label: t("extensions.appendSystemProject"), file: data?.project, draft: projectDraft, setDraft: setProjectDraft },
    { scope: "global", label: t("extensions.appendSystemGlobal"), file: data?.global, draft: globalDraft, setDraft: setGlobalDraft },
  ];

  return (
    <div className="packages-section">
      <div className="packages-section__header">
        <div>
          <h2>{t("extensions.appendSystem")}</h2>
          <p className="skill-detail__description">{t("extensions.appendSystemHint")}</p>
        </div>
      </div>

      {error ? <div className="activity-item activity-item--error"><div className="activity-item__text">{error}</div></div> : null}

      {scopes.map(({ scope, label, file, draft, setDraft }) => {
        const active = data?.activeScope === scope;
        const dirty = file ? draft !== file.content : draft.length > 0;
        return (
          <div className="append-system-scope" key={scope}>
            <div className="append-system-scope__head">
              <span className="skill-detail__meta-label">{label}</span>
              {active ? (
                <span className="slash-menu__skill-badge">{t("extensions.appendSystemActive")}</span>
              ) : (
                <span className="skill-card__meta"><span>{t("extensions.appendSystemInactive")}</span></span>
              )}
            </div>
            {file ? <div className="skill-detail__path">{file.path}</div> : null}
            <textarea
              className="append-system-scope__textarea"
              placeholder={t("extensions.appendSystemPlaceholder")}
              value={draft}
              disabled={busy}
              rows={4}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="packages-row__actions">
              <button
                className="button"
                type="button"
                disabled={busy || !dirty}
                onClick={() => save(scope, draft)}
              >
                {t("extensions.appendSystemSave")}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DetailItem({ label, value, mono }: { readonly label: string; readonly value: string; readonly mono?: boolean }) {
  return <div><div className="skill-detail__meta-label">{label}</div><div className={mono ? "skill-detail__path" : "skill-detail__description"}>{value}</div></div>;
}

function ExtensionContributionSection({ title, items, emptyLabel }: { readonly title: string; readonly items: readonly string[]; readonly emptyLabel: string }) {
  return <div className="skill-detail__meta-list"><div><div className="skill-detail__meta-label">{title}</div>
    {items.length > 0 ? <div className="extension-detail__tokens">{items.map((item) => <span className="slash-menu__skill-badge" key={item}>{item}</span>)}</div>
    : <div className="skill-detail__description">{emptyLabel}</div>}
  </div></div>;
}

function ExtensionDiagnostics({ diagnostics, t }: { readonly diagnostics: RuntimeExtensionRecord["diagnostics"]; readonly t: (k: string) => string }) {
  return <div className="skill-detail__meta-list"><div><div className="skill-detail__meta-label">{t("extensions.diagnostics")}</div>
    {diagnostics.length > 0 ? <div className="extension-detail__diagnostics">{diagnostics.map((d, i) =>
      <div className={`activity-item activity-item--${d.type === "error" ? "error" : "info"}`} key={`${d.message}:${i}`}>
        <div className="activity-item__text">{d.message}</div>{d.path ? <div className="activity-item__meta">{d.path}</div> : null}
      </div>)}</div>
    : <div className="skill-detail__description">{t("extensions.noDiagnostics")}</div>}
  </div></div>;
}

function ExtensionCompatibilitySection({ commands, compatibilityRecords, t }: {
  readonly commands: readonly string[];
  readonly compatibilityRecords: readonly ExtensionCommandCompatibilityRecord[];
  readonly t: (k: string) => string;
}) {
  const supported = compatibilityRecords.filter((r) => r.status === "supported");
  const terminalOnly = compatibilityRecords.filter((r) => r.status === "terminal-only");
  const unknown = commands.filter((c) => compatibilityRecords.every((r) => r.commandName !== c && !r.commandName.startsWith(`${c}:`)));
  return <div className="skill-detail__meta-list"><div>
    <div className="skill-detail__meta-label">{t("extensions.compatibility")}</div>
    <div className="skill-detail__description">{t("extensions.compatibilityHint")}</div>
    <div className="extension-detail__tokens">
      {supported.map((r) => <span className="slash-menu__skill-badge" key={`s:${r.commandName}`}>{r.commandName} · {t("extensions.guiCompatible")}</span>)}
      {terminalOnly.map((r) => <span className="slash-menu__skill-badge slash-menu__skill-badge--warning" key={`t:${r.commandName}`}>{r.commandName} · {t("extensions.terminalOnly")}</span>)}
      {unknown.map((c) => <span className="slash-menu__skill-badge" key={`u:${c}`}>{c} · {t("extensions.unknown")}</span>)}
    </div>
  </div></div>;
}

function ExtensionsEmptyState({ message }: { readonly message: string }) {
  return <div className="empty-state"><h2>No extensions found</h2><p>{message}</p></div>;
}
