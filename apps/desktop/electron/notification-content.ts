import type { Locale } from "../src/desktop-state";

interface NotificationCopy {
  readonly completed: string;
  readonly completionDetail: string;
  readonly failed: string;
  readonly limited: string;
  readonly rateLimitDetail: string;
  readonly attention: string;
  readonly codePrefix: string;
  readonly codeOpen: string;
  readonly codeClose: string;
}

const COPY: Record<Locale, NotificationCopy> = {
  en: {
    completed: "✅ Completed",
    completionDetail: "Agent finished responding",
    failed: "⚠️ Request failed",
    limited: "🈳 Request limited",
    rateLimitDetail: "Too many requests. Please try again later.",
    attention: "⚠️ Attention needed",
    codePrefix: " ",
    codeOpen: "(",
    codeClose: ")",
  },
  "zh-CN": {
    completed: "✅ 已完成",
    completionDetail: "Agent 已完成回复",
    failed: "⚠️ 请求失败",
    limited: "🈳 请求受限",
    rateLimitDetail: "请求过于频繁，请稍后重试",
    attention: "⚠️ 需要注意",
    codePrefix: "",
    codeOpen: "（",
    codeClose: "）",
  },
  "zh-TW": {
    completed: "✅ 已完成",
    completionDetail: "Agent 已完成回覆",
    failed: "⚠️ 請求失敗",
    limited: "🈳 請求受限",
    rateLimitDetail: "請求過於頻繁，請稍後重試",
    attention: "⚠️ 需要注意",
    codePrefix: "",
    codeOpen: "（",
    codeClose: "）",
  },
  ja: {
    completed: "✅ 完了",
    completionDetail: "Agent の応答が完了しました",
    failed: "⚠️ リクエスト失敗",
    limited: "🈳 リクエスト制限",
    rateLimitDetail: "リクエストが多すぎます。しばらくしてから再試行してください。",
    attention: "⚠️ 確認が必要",
    codePrefix: "",
    codeOpen: "（",
    codeClose: "）",
  },
};

type NotificationInput =
  | { readonly kind: "completed"; readonly locale: Locale; readonly sessionTitle: string }
  | { readonly kind: "failed"; readonly locale: Locale; readonly sessionTitle: string; readonly detail: string }
  | { readonly kind: "attention"; readonly locale: Locale; readonly sessionTitle: string; readonly detail: string };

export interface FormattedNotification {
  readonly title: string;
  readonly body: string;
}

export function formatSessionNotification(input: NotificationInput): FormattedNotification {
  const copy = COPY[input.locale];
  if (input.kind === "completed") {
    return { title: copy.completed, body: joinBody(input.sessionTitle, copy.completionDetail) };
  }
  if (input.kind === "attention") {
    return { title: copy.attention, body: joinBody(input.sessionTitle, input.detail) };
  }

  const statusCode = detectHttpStatus(input.detail);
  if (statusCode === 429) {
    return {
      title: withStatusCode(copy.limited, statusCode, copy),
      body: joinBody(input.sessionTitle, copy.rateLimitDetail),
    };
  }
  return {
    title: statusCode ? withStatusCode(copy.failed, statusCode, copy) : copy.failed,
    body: joinBody(input.sessionTitle, input.detail),
  };
}

function joinBody(sessionTitle: string, detail: string): string {
  return `${sessionTitle} · ${detail}`;
}

function withStatusCode(title: string, statusCode: number, copy: NotificationCopy): string {
  return `${title}${copy.codePrefix}${copy.codeOpen}${statusCode}${copy.codeClose}`;
}

function detectHttpStatus(detail: string): number | undefined {
  const match = detail.match(/(?:http(?:\s+status)?|status(?:\s+code)?)[/\s:(-]*([45]\d{2})\b/i)
    ?? detail.match(/\b(4\d{2}|5\d{2})\b/);
  if (!match?.[1]) return undefined;
  const statusCode = Number(match[1]);
  return Number.isInteger(statusCode) ? statusCode : undefined;
}
