import type { AgentBackendId } from "@pi-gui/session-driver";
import { PiGlyphIcon } from "./icons";

const ENGINE_DETAILS: Record<
  AgentBackendId,
  { readonly label: string; readonly description: string }
> = {
  pi: {
    label: "Pi",
    description:
      "Pi harness — native tools, skills, extensions and attachments",
  },
  fx: {
    label: "fx",
    description: "fx harness — independent ACP runtime and model session",
  },
};

export interface HarnessEngineSwitchProps {
  readonly activeEngine: AgentBackendId;
  readonly availableEngines?: readonly AgentBackendId[];
  readonly context:
    | { readonly kind: "new-thread" }
    | { readonly kind: "pane"; readonly label: "Left" | "Right" };
  readonly onSelect: (engine: AgentBackendId) => void;
}

export function HarnessEngineSwitch({
  activeEngine,
  availableEngines = ["pi", "fx"],
  context,
  onSelect,
}: HarnessEngineSwitchProps) {
  const paneLabel = context.kind === "pane" ? context.label : undefined;
  return (
    <div
      aria-label={paneLabel ? `${paneLabel} harness engine` : "New thread harness engine"}
      className="harness-engine-switch"
      role="group"
    >
      {(["pi", "fx"] as const)
        .filter((engine) => availableEngines.includes(engine))
        .map((engine) => {
          const details = ENGINE_DETAILS[engine];
          const active = engine === activeEngine;
          return (
            <button
              aria-label={context.kind === "pane"
                ? `Use ${details.label} harness in ${context.label.toLowerCase()} pane`
                : `Use ${details.label} harness for new thread`}
              aria-pressed={active}
              className={`harness-engine-switch__option harness-engine-switch__option--${engine}`}
              data-engine={engine}
              key={engine}
              onClick={(event) => {
                event.stopPropagation();
                onSelect(engine);
              }}
              title={details.description}
              type="button"
            >
              <span className="harness-engine-switch__mark">
                {engine === "pi" ? (
                  <PiGlyphIcon />
                ) : (
                  <span
                    aria-hidden="true"
                    className="harness-engine-switch__fx-mark"
                  >
                    ƒx
                  </span>
                )}
              </span>
              <span>{details.label}</span>
            </button>
          );
        })}
    </div>
  );
}
