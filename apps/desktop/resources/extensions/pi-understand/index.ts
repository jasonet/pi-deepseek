/**
 * pi-understand
 *
 * Bridges the Understand-Anything (UA) code-comprehension skill into pi.
 *
 * UA builds a deterministic knowledge graph of a codebase using tree-sitter
 * (WASM — no native toolchain) plus an LLM-driven analysis workflow, then lets
 * you ask questions and explain files against that graph. This extension ships
 * UA's `@understand-anything/core` + `@understand-anything/skill` packages and
 * the `skills/understand` workflow scripts in its own node_modules, so it runs
 * fully offline of the UA monorepo.
 *
 * Commands:
 *   /understand                 Build / refresh the knowledge graph for the
 *                               current project by following the bundled
 *                               SKILL.md workflow.
 *   /understand-explain <path>  Explain a file or directory using the saved
 *                               graph (deterministic builder + LLM narration).
 *   /understand-chat <question> Ask a question about the codebase, grounded in
 *                               the saved graph.
 *
 * The graph is persisted under `<project>/.understand-anything/`.
 */
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadGraph } from "@understand-anything/core";
import {
  buildExplainContext,
  formatExplainPrompt,
  buildChatPrompt,
} from "@understand-anything/skill";

const EXT_ID = "pi-understand";

/** Resolve the extension's own root, whether running from source or seeded. */
function extensionRoot(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    if (existsSync(join(here, "skills", "understand", "SKILL.md"))) return here;
  } catch {
    /* import.meta unavailable under some transpilers — fall through */
  }
  return join(homedir(), ".pi", "agent", "extensions", EXT_ID);
}

const SKILL_DIR = join(extensionRoot(), "skills", "understand");
const GRAPH_REL = ".understand-anything/knowledge-graph.json";

/** The project root pi is operating in. */
function projectRoot(): string {
  return process.cwd();
}

function graphExists(root: string): boolean {
  return existsSync(join(root, GRAPH_REL));
}

export default async function (pi: ExtensionAPI) {
  pi.registerCommand("understand", {
    description:
      "Build/refresh the Understand-Anything knowledge graph for this project",
    handler: async (_args, ctx) => {
      if (!existsSync(join(SKILL_DIR, "SKILL.md"))) {
        ctx.ui.notify(
          `${EXT_ID}: bundled workflow not found at ${SKILL_DIR}`,
          "error",
        );
        return;
      }
      pi.sendUserMessage(buildUnderstandPrompt(SKILL_DIR, projectRoot()));
    },
  });

  pi.registerCommand("understand-explain", {
    description:
      "Explain a file or directory from the Understand-Anything graph",
    handler: async (args, ctx) => {
      const target = args.trim();
      if (!target) {
        ctx.ui.notify(
          "Usage: /understand-explain <path>  (e.g. /understand-explain src/index.ts)",
          "warn",
        );
        return;
      }
      const root = projectRoot();
      if (!graphExists(root)) {
        ctx.ui.notify(
          `No knowledge graph found at ${join(root, GRAPH_REL)}. Run /understand first.`,
          "warn",
        );
        return;
      }
      try {
        const graph = loadGraph(root);
        if (!graph) {
          ctx.ui.notify(`${EXT_ID}: failed to load knowledge graph.`, "error");
          return;
        }
        const explainCtx = buildExplainContext(graph, target);
        const prompt = formatExplainPrompt(explainCtx);
        pi.sendUserMessage(prompt);
      } catch (e) {
        ctx.ui.notify(`${EXT_ID}: explain failed: ${(e as Error).message}`, "error");
      }
    },
  });

  pi.registerCommand("understand-chat", {
    description:
      "Ask a question about the codebase, grounded in the Understand-Anything graph",
    handler: async (args, ctx) => {
      const question = args.trim();
      if (!question) {
        ctx.ui.notify(
          "Usage: /understand-chat <question>  (e.g. /understand-chat how does auth work?)",
          "warn",
        );
        return;
      }
      const root = projectRoot();
      if (!graphExists(root)) {
        ctx.ui.notify(
          `No knowledge graph found at ${join(root, GRAPH_REL)}. Run /understand first.`,
          "warn",
        );
        return;
      }
      try {
        const graph = loadGraph(root);
        if (!graph) {
          ctx.ui.notify(`${EXT_ID}: failed to load knowledge graph.`, "error");
          return;
        }
        const prompt = buildChatPrompt(graph, question);
        pi.sendUserMessage(prompt);
      } catch (e) {
        ctx.ui.notify(`${EXT_ID}: chat failed: ${(e as Error).message}`, "error");
      }
    },
  });
}

function buildUnderstandPrompt(skillDir: string, root: string): string {
  return `# 任务：用 Understand-Anything 为当前工程构建知识图谱

工作流脚本与说明书已随扩展打包，位置：
- 说明书（必须先读）：\`${skillDir}/SKILL.md\`
- 工作流脚本目录：\`${skillDir}\`（scan-project.mjs / extract-structure.mjs / extract-import-map.mjs / build-fingerprints.mjs / compute-batches.mjs 等）
- 目标工程根目录：\`${root}\`

请严格按 SKILL.md 执行，要点：

1. **先读 SKILL.md**（用 Read 工具读取上面的绝对路径），完整理解它定义的多步流程后再动手。
2. 这些 \`.mjs\` 脚本依赖 \`@understand-anything/core\`，其 node_modules 已与脚本同根打包好。运行时**用 node 直接执行脚本的绝对路径**，工作目录保持在工程根 \`${root}\`，例如：
   \`node "${skillDir}/scan-project.mjs" <参数…>\`
   （tree-sitter 解析走 WASM，无需任何本地编译工具链。）
3. 按 SKILL.md 的顺序：扫描工程 → 提取结构 → 提取 import 关系 → 指纹 → 计算批次 → 分批 LLM 分析 → 合并，最终把知识图谱保存到 \`${root}/.understand-anything/\`。
4. 完成后给出简短小结：分析了多少文件、识别出的主要模块/域、图谱落盘路径。之后即可用 \`/understand-explain <path>\` 和 \`/understand-chat <问题>\`。

现在从读取 SKILL.md 开始。`;
}
