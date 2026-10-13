# DeepSeek Bot Navigation Entry & Detection Design

## Overview
Taosi integrates with DeepSeek Harness (DSH). When users install the `ds-bot` plugin in the web profile:
`npx @deepseek-ai/dsh@0.2.1-alpha.1 plugin --profile web add ds-bot`
`npx @deepseek-ai/dsh@0.2.1-alpha.1 web`

Taosi should detect the installed `ds-bot` module on the local machine and display a "DeepSeek Bot" entry in the left sidebar navigation right under/beside DeepSeek Harness. Clicking it opens the web interface at `http://127.0.0.1:3080/`.

The DeepSeek API key is shared automatically via the existing Taosi and DSH key synchronization, requiring no separate key configuration.

## Requirements
1. **Plugin Detection**:
   - Check if `ds-bot` is installed in `~/.dsh/profiles/web/package.json` (under dependencies or devDependencies) AND `~/.dsh/profiles/web/node_modules/ds-bot` exists.
   - Electron main process provides IPC to query `checkDsBotInstalled()`.
2. **UI Navigation**:
   - Sidebar renders a "DeepSeek Bot" nav item when installed.
   - `AppView` includes `"deepseek-bot"`.
   - Topbar displays "DeepSeek Bot".
   - Main content renders `DeepSeekBotView` (or shared DSH web view) pointing to `http://127.0.0.1:3080/`.
3. **Credentials**:
   - Reuses existing DSH synchronization for `DEEPSEEK_API_KEY`. No standalone configuration needed.
