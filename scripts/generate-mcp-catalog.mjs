import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(process.argv[2] ?? "../awesome-mcp-servers");
const source = await readFile(resolve(root, "README-zh.md"), "utf8");
const revision = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const entries = [];
let category = "";
for (const line of source.split(/\r?\n/)) {
  const heading = line.match(/^###\s+.*?<a name="[^"]+"><\/a>(.+)$/);
  if (heading) { category = heading[1].trim(); continue; }
  if (/^##\s/.test(line)) category = "";
  if (!category) continue;
  const match = line.match(/^[-*]\s+\[([^\]]+)\]\((https:\/\/github\.com\/[^\s)]+)\)\s*(.*?)\s+-\s+(.+)$/);
  if (!match) continue;
  entries.push({ category, name: match[1], url: match[2], tags: match[3], description: match[4] });
}
if (!entries.length) throw new Error("No catalog entries found; check the source format.");
await writeFile(resolve("apps/desktop/src/mcp-catalog.json"), JSON.stringify({ revision, entries }));
console.log(`Indexed ${entries.length} entries from ${revision}`);
