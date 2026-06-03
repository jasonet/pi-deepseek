import { useEffect, useMemo, useState } from "react";
import type { RuntimeExtensionRecord, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ExtensionCommandCompatibilityRecord, WorkspaceRecord } from "./desktop-state";
import { RefreshIcon } from "./icons";
import { useT } from "./i18n";

interface ExtensionsViewProps {
  readonly workspace?: WorkspaceRecord;
  readonly runtime?: RuntimeSnapshot;
  readonly commandCompatibility?: readonly ExtensionCommandCompatibilityRecord[];
  readonly onRefresh: () => void;
  readonly onOpenExtensionFolder: (filePath: string) => void;
  readonly onToggleExtension: (filePath: string, enabled: boolean) => void;
}

export function ExtensionsView({
  workspace, runtime, commandCompatibility = [],
  onRefresh, onOpenExtensionFolder, onToggleExtension,
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
      </div>
    </section>
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
