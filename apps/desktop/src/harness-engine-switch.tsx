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
  readonly paneLabel: "Left" | "Right";
  readonly onSelect: (engine: AgentBackendId) => void;
}

export function HarnessEngineSwitch({
  activeEngine,
  availableEngines = ["pi", "fx"],
  paneLabel,
  onSelect,
}: HarnessEngineSwitchProps) {
  return (
    <div
      aria-label={`${paneLabel} harness engine`}
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
              aria-label={`Use ${details.label} harness in ${paneLabel.toLowerCase()} pane`}
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
