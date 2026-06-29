/**
 * SystemPromptComposer — a thin, loosely-coupled layer for contributing
 * sectioned system-prompt content to the underlying pi runtime.
 *
 * Design intent (see repo guidelines: keep pi-sdk-driver thin over pi-mono;
 * loose coupling so Pi can self-upgrade):
 *
 * The pi SDK already builds the system prompt internally from its
 * ResourceLoader (`getSystemPrompt` / `getAppendSystemPrompt` / skills /
 * context files), and `DefaultResourceLoader` exposes a supported override
 * hook: `appendSystemPromptOverride(base: string[]) => string[]`. This module
 * does NOT reimplement prompt building. It only collects ordered, named
 * sections and produces a function shaped to that override hook, so the
 * harness can inject dynamic sections (identity, environment, reminders, …)
 * without forking the runtime.
 *
 * Safety: a composer with no registered sections is a strict pass-through —
 * `toAppendSystemPromptOverride(...)` returns the base array unchanged, so the
 * agent's prompt (and behavior) is byte-identical until a section is added.
 */

export interface PromptComposeContext {
  /** Working directory of the session/workspace. */
  readonly cwd: string;
  /** Wall-clock time used to render time-sensitive sections. */
  readonly now: Date;
  /** Human-readable workspace name, when known. */
  readonly workspaceName?: string;
  /** Free-form extra values a host may want to expose to sections. */
  readonly extras?: Readonly<Record<string, string>>;
}

export interface PromptSection {
  /** Stable identifier; re-registering the same id replaces the section. */
  readonly id: string;
  /** Lower runs earlier. Defaults to {@link DEFAULT_SECTION_ORDER}. */
  readonly order?: number;
  /**
   * Render the section body for the given context. Return `undefined` or an
   * empty/whitespace-only string to contribute nothing for this context.
   */
  render(context: PromptComposeContext): string | undefined;
}

export const DEFAULT_SECTION_ORDER = 100;

export class SystemPromptComposer {
  private readonly sections = new Map<string, PromptSection>();

  /** Register (or replace, by id) a section. */
  register(section: PromptSection): void {
    this.sections.set(section.id, section);
  }

  /** Remove a section by id. Returns true if one was removed. */
  unregister(id: string): boolean {
    return this.sections.delete(id);
  }

  has(id: string): boolean {
    return this.sections.has(id);
  }

  /** Number of registered sections. */
  get size(): number {
    return this.sections.size;
  }

  /** Registered sections in render order (stable: order, then id). */
  list(): readonly PromptSection[] {
    return [...this.sections.values()].sort(
      (a, b) =>
        (a.order ?? DEFAULT_SECTION_ORDER) - (b.order ?? DEFAULT_SECTION_ORDER) ||
        a.id.localeCompare(b.id),
    );
  }

  /**
   * Render all sections for a context, dropping empty results. A section that
   * throws is skipped (its failure must never break prompt assembly).
   */
  compose(context: PromptComposeContext): string[] {
    const out: string[] = [];
    for (const section of this.list()) {
      let body: string | undefined;
      try {
        body = section.render(context);
      } catch {
        body = undefined;
      }
      const trimmed = body?.trim();
      if (trimmed) {
        out.push(trimmed);
      }
    }
    return out;
  }

  /**
   * Produce a function matching `DefaultResourceLoader`'s
   * `appendSystemPromptOverride` option: it receives the loader's base append
   * entries and returns them with this composer's sections appended.
   *
   * With no registered sections this returns the base array unchanged.
   */
  toAppendSystemPromptOverride(
    context: PromptComposeContext,
  ): (base: readonly string[]) => string[] {
    return (base) => {
      const composed = this.compose(context);
      if (composed.length === 0) {
        return [...base];
      }
      return [...base, ...composed];
    };
  }
}

/**
 * Example built-in section: a compact environment preamble (workspace, cwd,
 * date). Not registered by default — hosts opt in by calling
 * `composer.register(environmentPreambleSection())`.
 */
export function environmentPreambleSection(order = 10): PromptSection {
  return {
    id: "environment-preamble",
    order,
    render: ({ cwd, now, workspaceName }) => {
      const lines = ["<pi-gui-environment>"];
      if (workspaceName) {
        lines.push(`Workspace: ${workspaceName}`);
      }
      lines.push(`Working directory: ${cwd}`);
      lines.push(`Current date: ${now.toISOString().slice(0, 10)}`);
      lines.push("</pi-gui-environment>");
      return lines.join("\n");
    },
  };
}
