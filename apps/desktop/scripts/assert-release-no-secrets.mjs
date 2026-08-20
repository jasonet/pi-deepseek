import { createReadStream, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const scanDir = path.resolve(
  desktopDir,
  process.env.PI_APP_RELEASE_SCAN_DIR?.trim() || "release",
);
const sensitiveValues = Object.entries(process.env)
  .filter(([name, value]) => isSensitiveEnvironmentName(name) && value && value.length >= 8)
  .map(([, value]) => value);
const uniqueSensitiveValues = [...new Set(sensitiveValues)];
const genericPatterns = [
  { label: "GitHub token", regex: /github_pat_[A-Za-z0-9_]{20,}/g },
  { label: "GitHub token", regex: /gh[pousr]_[A-Za-z0-9]{20,}/g },
  { label: "API key", regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
];

if (!existsSync(scanDir)) {
  throw new Error(`Release scan directory does not exist: ${scanDir}`);
}

const files = collectFiles(scanDir);
const findings = [];
for (const filePath of files) {
  const fileFindings = await scanFile(filePath);
  findings.push(...fileFindings.map((label) => ({ filePath, label })));
}

if (findings.length > 0) {
  const summary = findings
    .slice(0, 20)
    .map(({ filePath, label }) => `${label}: ${path.relative(scanDir, filePath)}`)
    .join("\n");
  throw new Error(`Release artifacts contain credential-like values:\n${summary}`);
}

console.log(JSON.stringify({
  ok: true,
  scanDir,
  filesChecked: files.length,
  environmentSecretsChecked: uniqueSensitiveValues.length,
  credentialPatternHits: 0,
}, null, 2));

function collectFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

async function scanFile(filePath) {
  const findings = new Set();
  let carry = "";
  for await (const chunk of createReadStream(filePath)) {
    const text = carry + chunk.toString("latin1");
    inspectText(text, findings);
    carry = text.slice(-512);
  }
  inspectText(carry, findings);
  return [...findings];
}

function inspectText(text, findings) {
  for (const secret of uniqueSensitiveValues) {
    if (text.includes(secret)) {
      findings.add("Environment secret");
    }
  }
  for (const { label, regex } of genericPatterns) {
    regex.lastIndex = 0;
    if (regex.test(text)) {
      findings.add(label);
    }
  }
}

function isSensitiveEnvironmentName(name) {
  return /(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_?KEY|CREDENTIAL)/i.test(name);
}
