import { expect, test } from "@playwright/test";
import { formatSessionNotification } from "../../electron/notification-content";

const cases = [
  { locale: "en", completed: "✅ Completed", attention: "⚠️ Attention needed", failed: "⚠️ Request failed (500)", limited: "🈳 Request limited (429)", done: "Agent finished responding", retry: "Too many requests. Please try again later." },
  { locale: "zh-CN", completed: "✅ 已完成", attention: "⚠️ 需要注意", failed: "⚠️ 请求失败（500）", limited: "🈳 请求受限（429）", done: "Agent 已完成回复", retry: "请求过于频繁，请稍后重试" },
  { locale: "zh-TW", completed: "✅ 已完成", attention: "⚠️ 需要注意", failed: "⚠️ 請求失敗（500）", limited: "🈳 請求受限（429）", done: "Agent 已完成回覆", retry: "請求過於頻繁，請稍後重試" },
  { locale: "ja", completed: "✅ 完了", attention: "⚠️ 確認が必要", failed: "⚠️ リクエスト失敗（500）", limited: "🈳 リクエスト制限（429）", done: "Agent の応答が完了しました", retry: "リクエストが多すぎます。しばらくしてから再試行してください。" },
] as const;

for (const item of cases) {
  test(`formats ${item.locale} notification titles before session details`, () => {
    expect(formatSessionNotification({ kind: "completed", locale: item.locale, sessionTitle: "Build release" })).toEqual({
      title: item.completed,
      body: `Build release · ${item.done}`,
    });
    expect(formatSessionNotification({ kind: "attention", locale: item.locale, sessionTitle: "Build release", detail: "Approve deployment" })).toEqual({
      title: item.attention,
      body: "Build release · Approve deployment",
    });
    expect(formatSessionNotification({ kind: "failed", locale: item.locale, sessionTitle: "Build release", detail: "HTTP 500 server error" })).toEqual({
      title: item.failed,
      body: "Build release · HTTP 500 server error",
    });
    expect(formatSessionNotification({ kind: "failed", locale: item.locale, sessionTitle: "Build release", detail: "429 Too Many Requests" })).toEqual({
      title: item.limited,
      body: `Build release · ${item.retry}`,
    });
  });
}

test("detects common status-code forms and omits an unavailable code", () => {
  expect(formatSessionNotification({ kind: "failed", locale: "en", sessionTitle: "One", detail: "status: 400 bad request" }).title).toBe("⚠️ Request failed (400)");
  expect(formatSessionNotification({ kind: "failed", locale: "en", sessionTitle: "Two", detail: "Request failed with status code 503" }).title).toBe("⚠️ Request failed (503)");
  expect(formatSessionNotification({ kind: "failed", locale: "en", sessionTitle: "Three", detail: "Connection reset" }).title).toBe("⚠️ Request failed");
});
