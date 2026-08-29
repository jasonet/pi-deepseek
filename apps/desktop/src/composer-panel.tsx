import { type ClipboardEvent, type Dispatch, type DragEvent, type KeyboardEvent, type RefObject, type SetStateAction, useState } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ComposerAttachment, QueuedComposerMessage, SessionRecord } from "./desktop-state";
import { ArrowUpIcon, PlusIcon, StopSquareIcon } from "./icons";
import type {
  ComposerSlashCommand,
  ComposerSlashCommandSection,
  ComposerSlashOption,
  ComposerSlashOptionEmptyState,
} from "./composer-commands";
import { useT } from "./i18n";
import { ComposerSurface } from "./composer-surface";
import { ModelOnboardingNoticeBanner } from "./model-onboarding-notice";
import type { ModelOnboardingState, ModelOnboardingSettingsSection } from "./model-onboarding";
import { ModelSelector } from "./model-selector";
import type { ExtensionDockModel } from "./extension-session-ui";

interface ComposerPanelProps {
  readonly selectedSession: SessionRecord;
  readonly lastError?: string;
  readonly hideErrorBanner?: boolean;
  readonly runtime?: RuntimeSnapshot;
  readonly activeSlashCommand?: ComposerSlashCommand;
  readonly activeSlashCommandMeta?: string;
  readonly composerDraft: string;
  readonly setComposerDraft: Dispatch<SetStateAction<string>>;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly runningLabel: string;
  readonly attachments: readonly ComposerAttachment[];
  readonly attachmentsEnabled?: boolean;
  readonly queuedMessages: readonly QueuedComposerMessage[];
  readonly editingQueuedMessageId?: string;
  readonly provider: string | undefined;
  readonly modelId: string | undefined;
  readonly thinkingLevel: string | undefined;
  readonly slashSections: readonly ComposerSlashCommandSection[];
  readonly slashOptions: readonly ComposerSlashOption[];
  readonly selectedSlashCommand?: ComposerSlashCommand;
  readonly selectedSlashOption?: ComposerSlashOption;
  readonly showSlashMenu: boolean;
  readonly showSlashOptionMenu: boolean;
  readonly slashOptionEmptyState?: ComposerSlashOptionEmptyState;
  readonly onClearSlashCommand: () => void;
  readonly onComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  readonly onComposerPaste: (event: ClipboardEvent<HTMLDivElement>) => void;
  readonly onComposerDrop: (event: DragEvent<HTMLDivElement>) => void;
  readonly onPickAttachments: () => void;
  readonly onRemoveAttachment: (attachmentId: string) => void;
  readonly onEditQueuedMessage: (messageId: string) => void;
  readonly onCancelQueuedEdit: () => void;
  readonly onRemoveQueuedMessage: (messageId: string) => void;
  readonly onSteerQueuedMessage: (messageId: string) => void;
  readonly onSelectSlashCommand: (command: ComposerSlashCommand) => void;
  readonly onSelectSlashOption: (option: ComposerSlashOption) => void;
  readonly onSetModel: (provider: string, modelId: string) => void;
  readonly onSetThinking: (level: string) => void;
  readonly modelOnboarding: ModelOnboardingState;
  readonly onOpenModelSettings: (section: ModelOnboardingSettingsSection) => void;
  readonly onSubmit: () => void;
  readonly onStop?: () => void;
  readonly onRetryLast?: () => void;
  readonly showMentionMenu: boolean;
  readonly mentionOptions: readonly string[];
  readonly selectedMentionIndex: number;
  readonly onSelectMention: (filePath: string) => void;
  readonly extensionDock?: ExtensionDockModel;
  readonly extensionDockExpanded: boolean;
  readonly onToggleExtensionDock: () => void;
}

export function ComposerPanel({
  selectedSession,
  lastError,
  hideErrorBanner = false,
  runtime,
  activeSlashCommand,
  activeSlashCommandMeta,
  composerDraft,
  setComposerDraft,
  composerRef,
  runningLabel,
  attachments,
  attachmentsEnabled,
  queuedMessages,
  editingQueuedMessageId,
  provider,
  modelId,
  thinkingLevel,
  slashSections,
  slashOptions,
  selectedSlashCommand,
  selectedSlashOption,
  showSlashMenu,
  showSlashOptionMenu,
  slashOptionEmptyState,
  onClearSlashCommand,
  onComposerKeyDown,
  onComposerPaste,
  onComposerDrop,
  onPickAttachments,
  onRemoveAttachment,
  onEditQueuedMessage,
  onCancelQueuedEdit,
  onRemoveQueuedMessage,
  onSteerQueuedMessage,
  onSelectSlashCommand,
  onSelectSlashOption,
  onSetModel,
  onSetThinking,
  modelOnboarding,
  onOpenModelSettings,
  onSubmit,
  onStop,
  onRetryLast,
  showMentionMenu,
  mentionOptions,
  selectedMentionIndex,
  onSelectMention,
  extensionDock,
  extensionDockExpanded,
  onToggleExtensionDock,
}: ComposerPanelProps) {
  const t = useT();
  const isFx = selectedSession.backendId === "fx";
  const canAttach = attachmentsEnabled ?? !isFx;
  const activeAttachments = canAttach ? attachments : [];
  const hasComposerInput = composerDraft.trim().length > 0 || activeAttachments.length > 0;
  const primaryActionIsStop = selectedSession.status === "running" && (isFx || !hasComposerInput);
  const showErrorBanner = Boolean(lastError) && !hideErrorBanner && selectedSession.status !== "failed";

  return (
    <footer className="composer">
      <div className="conversation conversation--composer">
        <ComposerSurface
          lastError={showErrorBanner ? lastError : undefined}
          activeSlashCommand={activeSlashCommand}
          activeSlashCommandMeta={activeSlashCommandMeta}
          topNotice={isFx ? undefined : (
            <ModelOnboardingNoticeBanner notice={modelOnboarding.notice} onOpenSettings={onOpenModelSettings} />
          )}
          composerDraft={composerDraft}
          setComposerDraft={setComposerDraft}
          composerRef={composerRef}
          attachments={activeAttachments}
          attachmentsEnabled={canAttach}
          queuedMessages={queuedMessages}
          editingQueuedMessageId={editingQueuedMessageId}
          slashSections={slashSections}
          slashOptions={slashOptions}
          selectedSlashCommand={selectedSlashCommand}
          selectedSlashOption={selectedSlashOption}
          showSlashMenu={showSlashMenu}
          showSlashOptionMenu={showSlashOptionMenu}
          slashOptionEmptyState={slashOptionEmptyState}
          onClearSlashCommand={onClearSlashCommand}
          onComposerKeyDown={onComposerKeyDown}
          onComposerPaste={onComposerPaste}
          onComposerDrop={onComposerDrop}
          onRemoveAttachment={onRemoveAttachment}
          onEditQueuedMessage={onEditQueuedMessage}
          onCancelQueuedEdit={onCancelQueuedEdit}
          onRemoveQueuedMessage={onRemoveQueuedMessage}
          onSteerQueuedMessage={onSteerQueuedMessage}
          onSelectSlashCommand={onSelectSlashCommand}
          onSelectSlashOption={onSelectSlashOption}
          showMentionMenu={showMentionMenu}
          mentionOptions={mentionOptions}
          selectedMentionIndex={selectedMentionIndex}
          onSelectMention={onSelectMention}
          textareaLabel="Composer"
          textareaTestId="composer"
          textareaPlaceholder={t("composer.placeholder")}
          extensionDock={extensionDock}
          extensionDockExpanded={extensionDockExpanded}
          onToggleExtensionDock={onToggleExtensionDock}
          footer={(
            <div className="composer__footer">
              <div className="composer__footer-row">
                {lastError ? (
                  <button
                    className="button button--secondary composer__retry-button"
                    onClick={onRetryLast}
                    type="button"
                  >
                    重试
                  </button>
                ) : null}
                <div className="composer__hint">
                  {selectedSession.status === "running"
                    ? isFx
                      ? `${runningLabel} · Stop before sending another message`
                      : `${runningLabel} · Enter to queue · Cmd+Enter to steer`
                    : "Enter to send · Shift+Enter for newline"}
                  {" · "}
                  {isFx ? (
                    <span className="composer__backend-model">
                      fx · {selectedSession.config?.modelId ?? "system model"}
                    </span>
                  ) : <ModelSelector
                    runtime={runtime}
                    provider={provider}
                    modelId={modelId}
                    thinkingLevel={thinkingLevel}
                    disabled={selectedSession.status === "running"}
                    unselectedModelLabel={modelOnboarding.unselectedModelLabel}
                    emptyModelTitle={modelOnboarding.emptyModelTitle}
                    onSetModel={onSetModel}
                    onSetThinking={onSetThinking}
                  />}
                </div>
                <div className="composer__actions">
                  <button
                    aria-label="Attach files"
                    className="icon-button composer__attach"
                    type="button"
                    disabled={!canAttach}
                    onClick={onPickAttachments}
                  >
                    <PlusIcon />
                  </button>
                  <button
                    aria-label={primaryActionIsStop ? "Stop run" : "Send message"}
                    className="button button--primary button--cta-icon"
                    data-testid="send"
                    type="button"
                    disabled={
                      !primaryActionIsStop &&
                      ((!composerDraft.trim() && activeAttachments.length === 0) || (!isFx && modelOnboarding.requiresModelSelection))
                    }
                    onClick={primaryActionIsStop ? (onStop ?? onSubmit) : onSubmit}
                  >
                    {primaryActionIsStop ? <StopSquareIcon /> : <ArrowUpIcon />}
                  </button>
                </div>
              </div>
            </div>
          )}
        />
      </div>
    </footer>
  );
}
