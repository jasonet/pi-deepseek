import { createContext, useContext, type ReactNode } from "react";

export type Locale = "en" | "zh-CN" | "ja";

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  "zh-CN": "中文（简体）",
  ja: "日本語",
};

export interface LocaleContextValue {
  readonly locale: Locale;
  readonly t: (key: string) => string;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: "en",
  t: (key: string) => key,
});

/* ── Translation map ────────────────────────────────── */

const translations: Record<Locale, Record<string, string>> = {
  en: {
    // Sidebar
    "sidebar.threads": "Threads",
    "sidebar.newThread": "New Thread",
    "sidebar.skills": "Skills",
    "sidebar.extensions": "Extensions",
    "sidebar.settings": "Settings",
    "sidebar.searchThreads": "Search threads…",

    // New Thread
    "newThread.title": "New Thread",
    "newThread.promptPlaceholder": "What do you want to build?",
    "newThread.startThread": "Start Thread",
    "newThread.starting": "Starting…",
    "newThread.environmentLocal": "Local",
    "newThread.environmentWorktree": "Worktree",
    "newThread.chooseWorkspace": "Choose a workspace",
    "newThread.noWorkspaces": "No workspaces yet. Use File > Open Folder.",

    // Thread groups
    "threads.today": "Today",
    "threads.yesterday": "Yesterday",
    "threads.thisWeek": "This Week",
    "threads.thisMonth": "This Month",
    "threads.older": "Older",
    "threads.archived": "Archived",
    "threads.noThreads": "No threads yet",
    "threads.noThreadsDesc": "Create a new thread to get started.",

    // Composer
    "composer.placeholder": "Send a message…",
    "composer.attachments": "Attachments",
    "composer.queuedMessages": "Queued messages",
    "composer.clearAttachments": "Clear attachments",

    // Settings → General
    "settings.general": "General",
    "settings.general.description": "Keep the high-value app and runtime controls close to hand.",
    "settings.general.connectedProviders": "Connected providers",
    "settings.general.discoveredSkills": "Discovered skills",
    "settings.general.modelSettingsScope": "Model settings scope",
    "settings.general.modelSettingsScopeDesc": "Choose whether model defaults apply everywhere or per repo.",
    "settings.general.appGlobal": "App global",
    "settings.general.perRepo": "Per repo",
    "settings.general.enableSkillCommands": "Enable skill slash commands",
    "settings.general.enableSkillCommandsDesc": "Keep skill slash commands available in the composer.",
    "settings.general.shellOfTerminal": "Shell of integrated terminal",
    "settings.general.shellOfTerminalDesc": "Leave blank to use your default login shell.",
    "settings.general.shortcuts": "Shortcuts",
    "settings.general.newThread": "New thread",
    "settings.general.openSettings": "Open settings",
    "settings.general.toggleTerminal": "Toggle terminal",
    "settings.general.newTerminalTab": "New terminal tab",
    "settings.general.sendMessage": "Send message",
    "settings.general.newLine": "New line",
    "settings.general.none": "None",

    // Settings → Appearance
    "settings.appearance": "Appearance",
    "settings.appearance.description": "Choose between light, dark, or automatic system theme.",
    "settings.appearance.theme": "Theme",
    "settings.appearance.system": "System",
    "settings.appearance.systemDesc": "Follow your OS appearance setting",
    "settings.appearance.light": "Light",
    "settings.appearance.lightDesc": "Always use the light theme",
    "settings.appearance.dark": "Dark",
    "settings.appearance.darkDesc": "Always use the dark theme",
    "settings.appearance.language": "Language",
    "settings.appearance.languageDesc": "Choose the UI display language.",
    "settings.appearance.visuals": "Visuals",
    "settings.appearance.transparency": "Window transparency",
    "settings.appearance.transparencyDesc": "Let desktop colors show through supported surfaces.",

    // Settings → Providers
    "settings.providers": "Providers",
    "settings.providers.description": "Connect providers and manage auth for {workspace}.",
    "settings.providers.connected": "Connected",
    "settings.providers.connectedDesc": "Connected providers are used first for picking models.",
    "settings.providers.noProviders": "No providers connected yet.",
    "settings.providers.signIn": "Sign in",
    "settings.providers.signInDesc": "OAuth-capable providers can sign in directly from the desktop app.",
    "settings.providers.allProviders": "All providers",
    "settings.providers.allProvidersDesc": "Browse the full provider inventory.",
    "settings.providers.browseAll": "Browse all providers",
    "settings.providers.searchProviders": "Search providers",
    "settings.providers.login": "Login",
    "settings.providers.logout": "Logout",
    "settings.providers.setApiKey": "Set API key",
    "settings.providers.manage": "Manage",
    "settings.providers.manageApiKey": "Manage API key",
    "settings.providers.setApiKeyTitle": "Set API key",
    "settings.providers.saveKey": "Save key",
    "settings.providers.saveApiKeyFor": "Save an API key locally for {provider}.",
    "settings.providers.replaceApiKeyFor": "Replace or remove the saved API key for {provider}.",
    "settings.providers.enterApiKey": "Enter API key",
    "settings.providers.removeSavedKey": "Remove saved key",
    "settings.providers.cancel": "Cancel",
    "settings.providers.managedExternally": "Managed externally",
    "settings.providers.configureExternally": "Configure externally",
    "settings.providers.oauthConnected": "OAuth · connected",
    "settings.providers.apiKeyConnected": "API key · connected",
    "settings.providers.envConnected": "Environment variable · connected",
    "settings.providers.externalConnected": "Configured externally · connected",
    "settings.providers.oauthAvailable": "OAuth",
    "settings.providers.apiKeyAvailable": "API key",
    "settings.providers.builtIn": "Built in",
    "settings.providers.needsApiKey": "Needs API key",

    // Settings → Models
    "settings.models": "Models",
    "settings.models.description": "Choose the default model and which models appear in pickers.",
    "settings.models.defaultModel": "Default model",
    "settings.models.defaultModelDesc": "Choose the default model for new sessions.",
    "settings.models.chooseModel": "Choose a model",
    "settings.models.reasoning": "Reasoning",
    "settings.models.reasoningDesc": "Set the default reasoning level for new sessions.",
    "settings.models.enabledModels": "Enabled models",
    "settings.models.enabledModelsDesc": "Choose which models appear in pickers throughout the app.",
    "settings.models.editEnabled": "Edit enabled models",
    "settings.models.searchEnabled": "Search enabled models",
    "settings.models.allModels": "All models",
    "settings.models.allModelsDesc": "Browse the full model catalog. Enable models above to use them.",
    "settings.models.browseAll": "Browse full model inventory",
    "settings.models.searchModels": "Search models",
    "settings.models.noAvailableModels": "No connected models available yet.",
    "settings.models.noEnabledModels": "No available models are currently enabled.",
    "settings.models.allEnabledDefault": "All available models enabled by default.",
    "settings.models.defaultNotEnabled": "Your default model ({provider}:{model}) is not enabled. Choose a new default above.",
    "settings.models.atLeastOne": "At least one model must be enabled",

    // Settings → Notifications
    "settings.notifications": "Notifications",
    "settings.notifications.description": "Manage both macOS notification access and which background events should alert you.",
    "settings.notifications.permission": "Notification permission",
    "settings.notifications.permissionDesc": "Pi-Deepseek needs permission to send system notifications.",
    "settings.notifications.permissionGranted": "Permission granted · notifications are allowed",
    "settings.notifications.permissionDenied": "Permission denied · notifications are blocked",
    "settings.notifications.permissionDefault": "Permission not granted · request below",
    "settings.notifications.permissionUnsupported": "Notifications not supported on this system",
    "settings.notifications.grantPermission": "Grant permission",
    "settings.notifications.granting": "Granting…",
    "settings.notifications.openSystemSettings": "Open system notification settings",
    "settings.notifications.backgroundEvents": "Background events",
    "settings.notifications.backgroundEventsDesc": "Choose which background events should alert you.",
    "settings.notifications.backgroundCompletion": "Background run completes",
    "settings.notifications.backgroundCompletionDesc": "Notify when a background session finishes successfully.",
    "settings.notifications.backgroundFailure": "Background run fails",
    "settings.notifications.backgroundFailureDesc": "Notify when a background session fails.",
    "settings.notifications.attentionNeeded": "Attention needed",
    "settings.notifications.attentionNeededDesc": "Notify when an active session needs user input.",
    "settings.notifications.unsupported": "Notifications are not supported on this system.",

    // Settings → Skills
    "settings.skills": "Skills",
    "settings.skills.description": "Manage skills for {workspace}.",

    // Settings → Extensions
    "settings.extensions": "Extensions",
    "settings.extensions.description": "Manage extensions for {workspace}.",

    // Skills view
    "skills.title": "Skills",
    "skills.description": "Browse and toggle skills for {workspace}.",
    "skills.search": "Search skills",

    // Extensions view
    "extensions.title": "Extensions",
    "extensions.description": "Browse and toggle extensions for {workspace}.",
    "extensions.search": "Search extensions",

    // Model selector
    "model.chooseModel": "Choose model",
    "model.searchModels": "Search models",
    "model.noMatching": "No matching models",
    "model.tryDifferent": "Try a different filter.",
    "model.reasoningLevel": "Reasoning level",
    "model.noModelsAvailable": "No models available",
    "model.noModelsAvailableDesc": "Open Settings to enable a model or log in to a provider.",

    // Model onboarding
    "onboarding.noModelsAvailable": "No models available",
    "onboarding.noModelsAvailableDesc": "Connect a provider in Settings > Providers before choosing a model or setting a default.",
    "onboarding.openSettingsProviders": "Open Settings > Providers",
    "onboarding.noModelsAvailableEnabled": "All available models are currently disabled. Open Settings > Models to enable models.",
    "onboarding.openSettingsModels": "Open Settings > Models",
    "onboarding.noDefaultModel": "No default model set",
    "onboarding.noDefaultModelDesc": "Set a default model in Settings > Models.",
    "onboarding.defaultModelUnavailable": "Default model unavailable",
    "onboarding.selectedModelUnavailable": "Selected model unavailable",

    // Topbar
    "topbar.working": "Working…",
    "topbar.workingFor": "Working for {time}",
    "topbar.jumpToLatest": "Jump to latest",
    "topbar.toggleDiff": "Toggle diff",

    // Thread
    "thread.loadingSession": "Loading session…",
    "thread.emptySession": "Send a message to start.",

    // Tree modal
    "tree.title": "Tree",
    "tree.loading": "Loading tree…",
    "tree.jumpTo": "Jump to",
    "tree.summarize": "Summarize",
    "tree.customInstructions": "Custom instructions",
    "tree.cancel": "Cancel",
    "tree.jumping": "Jumping…",
    "tree.empty": "Tree is empty. Send a message to build the tree.",

    // Diff panel
    "diff.title": "Diff",
    "diff.noFile": "No file selected",

    // Extension dialogs
    "extension.confirm": "Confirm",
    "extension.cancel": "Cancel",
    "extension.ok": "OK",

    // Shell
    "shell.loading": "Loading sessions",
    "shell.loadingDesc": "The desktop shell is restoring folder and thread state from the main process.",

    // Common
    "common.selectWorkspace": "Select a workspace",
    "common.loading": "Loading…",
    "common.error": "Error",
    "common.close": "Close",
    "common.save": "Save",
    "common.edit": "Edit",
    "common.delete": "Delete",
    "common.rename": "Rename",
    "common.archive": "Archive",
    "common.unarchive": "Unarchive",
    "common.search": "Search",
    "common.clear": "Clear",
    "common.refresh": "Refresh",
  },

  "zh-CN": {
    // Sidebar
    "sidebar.threads": "会话",
    "sidebar.newThread": "新建会话",
    "sidebar.skills": "技能",
    "sidebar.extensions": "扩展",
    "sidebar.settings": "设置",
    "sidebar.searchThreads": "搜索会话…",

    // New Thread
    "newThread.title": "新建会话",
    "newThread.promptPlaceholder": "你想构建什么？",
    "newThread.startThread": "开始会话",
    "newThread.starting": "启动中…",
    "newThread.environmentLocal": "本地",
    "newThread.environmentWorktree": "工作树",
    "newThread.chooseWorkspace": "选择工作区",
    "newThread.noWorkspaces": "暂无工作区。使用 文件 > 打开文件夹。",

    // Thread groups
    "threads.today": "今天",
    "threads.yesterday": "昨天",
    "threads.thisWeek": "本周",
    "threads.thisMonth": "本月",
    "threads.older": "更早",
    "threads.archived": "已归档",
    "threads.noThreads": "暂无会话",
    "threads.noThreadsDesc": "创建一个新会话来开始。",

    // Composer
    "composer.placeholder": "发送消息…",
    "composer.attachments": "附件",
    "composer.queuedMessages": "排队消息",
    "composer.clearAttachments": "清除附件",

    // Settings → General
    "settings.general": "通用",
    "settings.general.description": "将高频应用和运行时控制项放在手边。",
    "settings.general.connectedProviders": "已连接的提供商",
    "settings.general.discoveredSkills": "已发现的技能",
    "settings.general.modelSettingsScope": "模型设置范围",
    "settings.general.modelSettingsScopeDesc": "选择模型默认为全局应用还是按仓库设置。",
    "settings.general.appGlobal": "全局应用",
    "settings.general.perRepo": "按仓库",
    "settings.general.enableSkillCommands": "启用技能斜杠命令",
    "settings.general.enableSkillCommandsDesc": "在输入框中保持技能斜杠命令可用。",
    "settings.general.shellOfTerminal": "集成终端 Shell",
    "settings.general.shellOfTerminalDesc": "留空则使用默认登录 Shell。",
    "settings.general.shortcuts": "快捷键",
    "settings.general.newThread": "新建会话",
    "settings.general.openSettings": "打开设置",
    "settings.general.toggleTerminal": "切换终端",
    "settings.general.newTerminalTab": "新建终端标签页",
    "settings.general.sendMessage": "发送消息",
    "settings.general.newLine": "换行",
    "settings.general.none": "无",

    // Settings → Appearance
    "settings.appearance": "外观",
    "settings.appearance.description": "在浅色、深色或自动跟随系统主题之间选择。",
    "settings.appearance.theme": "主题",
    "settings.appearance.system": "跟随系统",
    "settings.appearance.systemDesc": "跟随操作系统的外观设置",
    "settings.appearance.light": "浅色",
    "settings.appearance.lightDesc": "始终使用浅色主题",
    "settings.appearance.dark": "深色",
    "settings.appearance.darkDesc": "始终使用深色主题",
    "settings.appearance.language": "语言",
    "settings.appearance.languageDesc": "选择界面显示语言。",
    "settings.appearance.visuals": "视觉效果",
    "settings.appearance.transparency": "窗口透明",
    "settings.appearance.transparencyDesc": "允许桌面颜色透过支持的区域显示。",

    // Settings → Providers
    "settings.providers": "提供商",
    "settings.providers.description": "为 {workspace} 连接提供商并管理认证。",
    "settings.providers.connected": "已连接",
    "settings.providers.connectedDesc": "已连接的提供商会优先用于选择模型。",
    "settings.providers.noProviders": "尚未连接任何提供商。",
    "settings.providers.signIn": "登录",
    "settings.providers.signInDesc": "支持 OAuth 的提供商可直接从桌面应用登录。",
    "settings.providers.allProviders": "所有提供商",
    "settings.providers.allProvidersDesc": "浏览完整的提供商列表。",
    "settings.providers.browseAll": "浏览所有提供商",
    "settings.providers.searchProviders": "搜索提供商",
    "settings.providers.login": "登录",
    "settings.providers.logout": "退出",
    "settings.providers.setApiKey": "设置 API 密钥",
    "settings.providers.manage": "管理",
    "settings.providers.manageApiKey": "管理 API 密钥",
    "settings.providers.setApiKeyTitle": "设置 API 密钥",
    "settings.providers.saveKey": "保存密钥",
    "settings.providers.saveApiKeyFor": "在本地为 {provider} 保存 API 密钥。",
    "settings.providers.replaceApiKeyFor": "替换或移除 {provider} 已保存的 API 密钥。",
    "settings.providers.enterApiKey": "输入 API 密钥",
    "settings.providers.removeSavedKey": "移除已保存的密钥",
    "settings.providers.cancel": "取消",
    "settings.providers.managedExternally": "外部管理",
    "settings.providers.configureExternally": "外部配置",
    "settings.providers.oauthConnected": "OAuth · 已连接",
    "settings.providers.apiKeyConnected": "API 密钥 · 已连接",
    "settings.providers.envConnected": "环境变量 · 已连接",
    "settings.providers.externalConnected": "外部配置 · 已连接",
    "settings.providers.oauthAvailable": "OAuth",
    "settings.providers.apiKeyAvailable": "API 密钥",
    "settings.providers.builtIn": "内置",
    "settings.providers.needsApiKey": "需要 API 密钥",

    // Settings → Models
    "settings.models": "模型",
    "settings.models.description": "选择默认模型以及哪些模型出现在选择器中。",
    "settings.models.defaultModel": "默认模型",
    "settings.models.defaultModelDesc": "为新会话选择默认模型。",
    "settings.models.chooseModel": "选择模型",
    "settings.models.reasoning": "推理",
    "settings.models.reasoningDesc": "为新会话设置默认推理级别。",
    "settings.models.enabledModels": "已启用模型",
    "settings.models.enabledModelsDesc": "选择哪些模型出现在应用的选择器中。",
    "settings.models.editEnabled": "编辑已启用模型",
    "settings.models.searchEnabled": "搜索已启用模型",
    "settings.models.allModels": "所有模型",
    "settings.models.allModelsDesc": "浏览完整的模型目录。在上方启用模型后即可使用。",
    "settings.models.browseAll": "浏览全部模型清单",
    "settings.models.searchModels": "搜索模型",
    "settings.models.noAvailableModels": "暂无可用模型。",
    "settings.models.noEnabledModels": "当前没有已启用的可用模型。",
    "settings.models.allEnabledDefault": "所有可用模型已默认启用。",
    "settings.models.defaultNotEnabled": "您的默认模型（{provider}:{model}）未启用。请在上方选择新的默认模型。",
    "settings.models.atLeastOne": "至少需要启用一个模型",

    // Settings → Notifications
    "settings.notifications": "通知",
    "settings.notifications.description": "管理 macOS 通知权限以及哪些后台事件需要提醒。",
    "settings.notifications.permission": "通知权限",
    "settings.notifications.permissionDesc": "Pi-Deepseek 需要权限才能发送系统通知。",
    "settings.notifications.permissionGranted": "权限已授予 · 通知已允许",
    "settings.notifications.permissionDenied": "权限已拒绝 · 通知已被阻止",
    "settings.notifications.permissionDefault": "权限未授予 · 请在下方请求",
    "settings.notifications.permissionUnsupported": "此系统不支持通知",
    "settings.notifications.grantPermission": "授予权限",
    "settings.notifications.granting": "授予中…",
    "settings.notifications.openSystemSettings": "打开系统通知设置",
    "settings.notifications.backgroundEvents": "后台事件",
    "settings.notifications.backgroundEventsDesc": "选择哪些后台事件需要提醒。",
    "settings.notifications.backgroundCompletion": "后台运行完成",
    "settings.notifications.backgroundCompletionDesc": "后台会话成功完成时通知。",
    "settings.notifications.backgroundFailure": "后台运行失败",
    "settings.notifications.backgroundFailureDesc": "后台会话失败时通知。",
    "settings.notifications.attentionNeeded": "需要注意",
    "settings.notifications.attentionNeededDesc": "活动会话需要用户输入时通知。",
    "settings.notifications.unsupported": "此系统不支持通知。",

    // Settings → Skills
    "settings.skills": "技能",
    "settings.skills.description": "管理 {workspace} 的技能。",

    // Settings → Extensions
    "settings.extensions": "扩展",
    "settings.extensions.description": "管理 {workspace} 的扩展。",

    // Skills view
    "skills.title": "技能",
    "skills.description": "浏览并切换 {workspace} 的技能。",
    "skills.search": "搜索技能",

    // Extensions view
    "extensions.title": "扩展",
    "extensions.description": "浏览并切换 {workspace} 的扩展。",
    "extensions.search": "搜索扩展",

    // Model selector
    "model.chooseModel": "选择模型",
    "model.searchModels": "搜索模型",
    "model.noMatching": "无匹配模型",
    "model.tryDifferent": "尝试不同的筛选条件。",
    "model.reasoningLevel": "推理级别",
    "model.noModelsAvailable": "无可用模型",
    "model.noModelsAvailableDesc": "打开设置启用模型或登录提供商。",

    // Model onboarding
    "onboarding.noModelsAvailable": "无可用模型",
    "onboarding.noModelsAvailableDesc": "在选择模型或设置默认之前，请在 设置 > 提供商 中连接提供商。",
    "onboarding.openSettingsProviders": "打开 设置 > 提供商",
    "onboarding.noModelsAvailableEnabled": "当前所有可用模型均已禁用。打开 设置 > 模型 来启用模型。",
    "onboarding.openSettingsModels": "打开 设置 > 模型",
    "onboarding.noDefaultModel": "未设置默认模型",
    "onboarding.noDefaultModelDesc": "在 设置 > 模型 中设置默认模型。",
    "onboarding.defaultModelUnavailable": "默认模型不可用",
    "onboarding.selectedModelUnavailable": "所选模型不可用",

    // Topbar
    "topbar.working": "工作中…",
    "topbar.workingFor": "已工作 {time}",
    "topbar.jumpToLatest": "跳至最新",
    "topbar.toggleDiff": "切换差异",

    // Thread
    "thread.loadingSession": "正在加载会话…",
    "thread.emptySession": "发送消息以开始。",

    // Tree modal
    "tree.title": "树形图",
    "tree.loading": "正在加载树形图…",
    "tree.jumpTo": "跳转到",
    "tree.summarize": "摘要",
    "tree.customInstructions": "自定义指令",
    "tree.cancel": "取消",
    "tree.jumping": "跳转中…",
    "tree.empty": "树形图为空。发送消息以构建树形图。",

    // Diff panel
    "diff.title": "差异",
    "diff.noFile": "未选择文件",

    // Extension dialogs
    "extension.confirm": "确认",
    "extension.cancel": "取消",
    "extension.ok": "确定",

    // Shell
    "shell.loading": "正在加载会话",
    "shell.loadingDesc": "桌面 Shell 正在从主进程恢复文件夹和会话状态。",

    // Common
    "common.selectWorkspace": "选择工作区",
    "common.loading": "加载中…",
    "common.error": "错误",
    "common.close": "关闭",
    "common.save": "保存",
    "common.edit": "编辑",
    "common.delete": "删除",
    "common.rename": "重命名",
    "common.archive": "归档",
    "common.unarchive": "取消归档",
    "common.search": "搜索",
    "common.clear": "清除",
    "common.refresh": "刷新",
  },

  ja: {
    // Sidebar
    "sidebar.threads": "スレッド",
    "sidebar.newThread": "新規スレッド",
    "sidebar.skills": "スキル",
    "sidebar.extensions": "拡張機能",
    "sidebar.settings": "設定",
    "sidebar.searchThreads": "スレッドを検索…",

    // New Thread
    "newThread.title": "新規スレッド",
    "newThread.promptPlaceholder": "何を作りたいですか？",
    "newThread.startThread": "スレッドを開始",
    "newThread.starting": "開始中…",
    "newThread.environmentLocal": "ローカル",
    "newThread.environmentWorktree": "ワークツリー",
    "newThread.chooseWorkspace": "ワークスペースを選択",
    "newThread.noWorkspaces": "ワークスペースがありません。ファイル > フォルダを開く。",

    // Thread groups
    "threads.today": "今日",
    "threads.yesterday": "昨日",
    "threads.thisWeek": "今週",
    "threads.thisMonth": "今月",
    "threads.older": "以前",
    "threads.archived": "アーカイブ済み",
    "threads.noThreads": "スレッドがありません",
    "threads.noThreadsDesc": "新しいスレッドを作成して開始してください。",

    // Composer
    "composer.placeholder": "メッセージを送信…",
    "composer.attachments": "添付ファイル",
    "composer.queuedMessages": "キュー内メッセージ",
    "composer.clearAttachments": "添付をクリア",

    // Settings → General
    "settings.general": "一般",
    "settings.general.description": "よく使うアプリとランタイムの設定を手元に。",
    "settings.general.connectedProviders": "接続済みプロバイダー",
    "settings.general.discoveredSkills": "検出されたスキル",
    "settings.general.modelSettingsScope": "モデル設定の範囲",
    "settings.general.modelSettingsScopeDesc": "モデルのデフォルトを全体適用するかリポジトリごとに設定するか選択します。",
    "settings.general.appGlobal": "アプリ全体",
    "settings.general.perRepo": "リポジトリごと",
    "settings.general.enableSkillCommands": "スキルスラッシュコマンドを有効化",
    "settings.general.enableSkillCommandsDesc": "入力欄でスキルスラッシュコマンドを使用可能にします。",
    "settings.general.shellOfTerminal": "統合ターミナルのシェル",
    "settings.general.shellOfTerminalDesc": "空白のままにするとデフォルトのログインシェルを使用します。",
    "settings.general.shortcuts": "ショートカット",
    "settings.general.newThread": "新規スレッド",
    "settings.general.openSettings": "設定を開く",
    "settings.general.toggleTerminal": "ターミナル切替",
    "settings.general.newTerminalTab": "新規ターミナルタブ",
    "settings.general.sendMessage": "メッセージ送信",
    "settings.general.newLine": "改行",
    "settings.general.none": "なし",

    // Settings → Appearance
    "settings.appearance": "外観",
    "settings.appearance.description": "ライト、ダーク、または自動システムテーマから選択します。",
    "settings.appearance.theme": "テーマ",
    "settings.appearance.system": "システム",
    "settings.appearance.systemDesc": "OS の外観設定に従います",
    "settings.appearance.light": "ライト",
    "settings.appearance.lightDesc": "常にライトテーマを使用します",
    "settings.appearance.dark": "ダーク",
    "settings.appearance.darkDesc": "常にダークテーマを使用します",
    "settings.appearance.language": "言語",
    "settings.appearance.languageDesc": "UI の表示言語を選択します。",
    "settings.appearance.visuals": "ビジュアル",
    "settings.appearance.transparency": "ウィンドウの透過",
    "settings.appearance.transparencyDesc": "対応している領域でデスクトップの色を透過表示します。",

    // Settings → Providers
    "settings.providers": "プロバイダー",
    "settings.providers.description": "{workspace} のプロバイダーを接続し認証を管理します。",
    "settings.providers.connected": "接続済み",
    "settings.providers.connectedDesc": "接続済みプロバイダーがモデル選択時に優先されます。",
    "settings.providers.noProviders": "まだプロバイダーが接続されていません。",
    "settings.providers.signIn": "サインイン",
    "settings.providers.signInDesc": "OAuth 対応プロバイダーはデスクトップアプリから直接サインインできます。",
    "settings.providers.allProviders": "すべてのプロバイダー",
    "settings.providers.allProvidersDesc": "プロバイダーの全一覧を閲覧します。",
    "settings.providers.browseAll": "すべてのプロバイダーを閲覧",
    "settings.providers.searchProviders": "プロバイダーを検索",
    "settings.providers.login": "ログイン",
    "settings.providers.logout": "ログアウト",
    "settings.providers.setApiKey": "API キーを設定",
    "settings.providers.manage": "管理",
    "settings.providers.manageApiKey": "API キーを管理",
    "settings.providers.setApiKeyTitle": "API キーを設定",
    "settings.providers.saveKey": "キーを保存",
    "settings.providers.saveApiKeyFor": "{provider} の API キーをローカルに保存します。",
    "settings.providers.replaceApiKeyFor": "{provider} の保存済み API キーを置換または削除します。",
    "settings.providers.enterApiKey": "API キーを入力",
    "settings.providers.removeSavedKey": "保存済みキーを削除",
    "settings.providers.cancel": "キャンセル",
    "settings.providers.managedExternally": "外部管理",
    "settings.providers.configureExternally": "外部で設定",
    "settings.providers.oauthConnected": "OAuth · 接続済み",
    "settings.providers.apiKeyConnected": "API キー · 接続済み",
    "settings.providers.envConnected": "環境変数 · 接続済み",
    "settings.providers.externalConnected": "外部設定 · 接続済み",
    "settings.providers.oauthAvailable": "OAuth",
    "settings.providers.apiKeyAvailable": "API キー",
    "settings.providers.builtIn": "内蔵",
    "settings.providers.needsApiKey": "API キーが必要",

    // Settings → Models
    "settings.models": "モデル",
    "settings.models.description": "デフォルトモデルとピッカーに表示するモデルを選択します。",
    "settings.models.defaultModel": "デフォルトモデル",
    "settings.models.defaultModelDesc": "新規セッションのデフォルトモデルを選択します。",
    "settings.models.chooseModel": "モデルを選択",
    "settings.models.reasoning": "推論",
    "settings.models.reasoningDesc": "新規セッションのデフォルト推論レベルを設定します。",
    "settings.models.enabledModels": "有効なモデル",
    "settings.models.enabledModelsDesc": "アプリのピッカーに表示するモデルを選択します。",
    "settings.models.editEnabled": "有効モデルを編集",
    "settings.models.searchEnabled": "有効モデルを検索",
    "settings.models.allModels": "すべてのモデル",
    "settings.models.allModelsDesc": "モデルカタログを閲覧します。上でモデルを有効にすると使用可能になります。",
    "settings.models.browseAll": "全モデル一覧を閲覧",
    "settings.models.searchModels": "モデルを検索",
    "settings.models.noAvailableModels": "利用可能なモデルがまだありません。",
    "settings.models.noEnabledModels": "現在有効な利用可能モデルはありません。",
    "settings.models.allEnabledDefault": "すべての利用可能モデルがデフォルトで有効です。",
    "settings.models.defaultNotEnabled": "デフォルトモデル（{provider}:{model}）が無効です。上で新しいデフォルトを選択してください。",
    "settings.models.atLeastOne": "少なくとも1つのモデルを有効にする必要があります",

    // Settings → Notifications
    "settings.notifications": "通知",
    "settings.notifications.description": "macOS 通知権限と、通知するバックグラウンドイベントを管理します。",
    "settings.notifications.permission": "通知権限",
    "settings.notifications.permissionDesc": "Pi-Deepseek がシステム通知を送信するには権限が必要です。",
    "settings.notifications.permissionGranted": "権限付与済み · 通知が許可されています",
    "settings.notifications.permissionDenied": "権限拒否 · 通知がブロックされています",
    "settings.notifications.permissionDefault": "権限未付与 · 以下からリクエストしてください",
    "settings.notifications.permissionUnsupported": "このシステムでは通知はサポートされていません",
    "settings.notifications.grantPermission": "権限を付与",
    "settings.notifications.granting": "付与中…",
    "settings.notifications.openSystemSettings": "システム通知設定を開く",
    "settings.notifications.backgroundEvents": "バックグラウンドイベント",
    "settings.notifications.backgroundEventsDesc": "通知するバックグラウンドイベントを選択します。",
    "settings.notifications.backgroundCompletion": "バックグラウンド実行完了",
    "settings.notifications.backgroundCompletionDesc": "バックグラウンドセッションが正常に完了したときに通知します。",
    "settings.notifications.backgroundFailure": "バックグラウンド実行失敗",
    "settings.notifications.backgroundFailureDesc": "バックグラウンドセッションが失敗したときに通知します。",
    "settings.notifications.attentionNeeded": "注意が必要",
    "settings.notifications.attentionNeededDesc": "アクティブなセッションがユーザー入力を必要とするときに通知します。",
    "settings.notifications.unsupported": "このシステムでは通知はサポートされていません。",

    // Settings → Skills
    "settings.skills": "スキル",
    "settings.skills.description": "{workspace} のスキルを管理します。",

    // Settings → Extensions
    "settings.extensions": "拡張機能",
    "settings.extensions.description": "{workspace} の拡張機能を管理します。",

    // Skills view
    "skills.title": "スキル",
    "skills.description": "{workspace} のスキルを閲覧・切替します。",
    "skills.search": "スキルを検索",

    // Extensions view
    "extensions.title": "拡張機能",
    "extensions.description": "{workspace} の拡張機能を閲覧・切替します。",
    "extensions.search": "拡張機能を検索",

    // Model selector
    "model.chooseModel": "モデルを選択",
    "model.searchModels": "モデルを検索",
    "model.noMatching": "一致するモデルなし",
    "model.tryDifferent": "別のフィルターをお試しください。",
    "model.reasoningLevel": "推論レベル",
    "model.noModelsAvailable": "利用可能なモデルなし",
    "model.noModelsAvailableDesc": "設定を開いてモデルを有効にするか、プロバイダーにログインしてください。",

    // Model onboarding
    "onboarding.noModelsAvailable": "利用可能なモデルなし",
    "onboarding.noModelsAvailableDesc": "モデルを選択またはデフォルトを設定する前に、設定 > プロバイダーでプロバイダーを接続してください。",
    "onboarding.openSettingsProviders": "設定 > プロバイダーを開く",
    "onboarding.noModelsAvailableEnabled": "現在すべての利用可能モデルが無効です。設定 > モデルを開いてモデルを有効にしてください。",
    "onboarding.openSettingsModels": "設定 > モデルを開く",
    "onboarding.noDefaultModel": "デフォルトモデル未設定",
    "onboarding.noDefaultModelDesc": "設定 > モデルでデフォルトモデルを設定してください。",
    "onboarding.defaultModelUnavailable": "デフォルトモデルが利用不可",
    "onboarding.selectedModelUnavailable": "選択されたモデルが利用不可",

    // Topbar
    "topbar.working": "作業中…",
    "topbar.workingFor": "{time} 作業中",
    "topbar.jumpToLatest": "最新にジャンプ",
    "topbar.toggleDiff": "差分を切替",

    // Thread
    "thread.loadingSession": "セッションを読み込み中…",
    "thread.emptySession": "メッセージを送信して開始してください。",

    // Tree modal
    "tree.title": "ツリー",
    "tree.loading": "ツリーを読み込み中…",
    "tree.jumpTo": "ジャンプ",
    "tree.summarize": "要約",
    "tree.customInstructions": "カスタム指示",
    "tree.cancel": "キャンセル",
    "tree.jumping": "ジャンプ中…",
    "tree.empty": "ツリーが空です。メッセージを送信してツリーを構築してください。",

    // Diff panel
    "diff.title": "差分",
    "diff.noFile": "ファイルが選択されていません",

    // Extension dialogs
    "extension.confirm": "確認",
    "extension.cancel": "キャンセル",
    "extension.ok": "OK",

    // Shell
    "shell.loading": "セッションを読み込み中",
    "shell.loadingDesc": "デスクトップシェルがメインプロセスからフォルダとスレッドの状態を復元しています。",

    // Common
    "common.selectWorkspace": "ワークスペースを選択",
    "common.loading": "読み込み中…",
    "common.error": "エラー",
    "common.close": "閉じる",
    "common.save": "保存",
    "common.edit": "編集",
    "common.delete": "削除",
    "common.rename": "名前変更",
    "common.archive": "アーカイブ",
    "common.unarchive": "アーカイブ解除",
    "common.search": "検索",
    "common.clear": "クリア",
    "common.refresh": "更新",
  },
};

/* ── Simple template interpolation ──────────────────── */

function template(str: string, vars: Record<string, string>): string {
  return str.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`);
}

/* ── Hook ───────────────────────────────────────────── */

export function useT() {
  const ctx = useContext(LocaleContext);
  return (key: string, vars?: Record<string, string>) => {
    const raw = translations[ctx.locale]?.[key] ?? translations.en[key] ?? key;
    return vars ? template(raw, vars) : raw;
  };
}

export function useLocale() {
  return useContext(LocaleContext);
}

/* ── Provider ───────────────────────────────────────── */

export function LocaleProvider({
  locale,
  children,
}: {
  readonly locale: Locale;
  readonly children: ReactNode;
}) {
  const t = (key: string, vars?: Record<string, string>) => {
    const raw = translations[locale]?.[key] ?? translations.en[key] ?? key;
    return vars ? template(raw, vars) : raw;
  };

  return (
    <LocaleContext.Provider value={{ locale, t }}>
      {children}
    </LocaleContext.Provider>
  );
}
