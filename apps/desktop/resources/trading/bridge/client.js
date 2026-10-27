window.__ModuleLoader__.load({
  id: "@taosi/dsh-trading-bridge",
  factory: () => ({
    inject: ["slots", "uiWorkspace", "sessions", "conversation"],
    apply(ctx) {
      const parentOrigin = "__TAOSI_PARENT_ORIGIN__";
      const examples = {
        overview: "请先检索本地知识库，然后制作一份跨市场研究示例：区分已核实的数据与待核实假设，比较加密货币、美股和 A 股的主要风险。仅做分析，不下单、不签署实盘授权，不自动写入知识库。注明数据时间、来源与缺口。",
        crypto: "请先检索本地知识库，对 BTC 现货做一次研究示例：核实最新行情和数据时间，分析趋势、波动、流动性和反方情景。仅做分析，不下单、不修改杠杆或实盘设置；无法获取的数据要明确说明。",
        us: "请先检索本地知识库，对 AAPL 做一次公司分析示例：优先核验原始披露，区分财务事实、估值假设和风险情景，注明资料日期与来源。仅做研究，不下单、不签署实盘授权。",
        cn: "请先检索本地知识库，对贵州茅台 600519 做一次 A 股研究示例：核验公告、财务与行情数据时间，列出经营风险、估值假设和反方情景。仅做研究，不下单，不自动保存到知识库。",
      };
      const reply = (requestId, ok, message) => window.parent.postMessage({ channel: "taosi-trading", requestId, ok, message }, "*");
      const onMessage = async (event) => {
        if (event.source !== window.parent || (parentOrigin === "file" ? !["null", "file://"].includes(event.origin) : event.origin !== parentOrigin)) return;
        const data = event.data;
        if (data?.channel !== "taosi-trading" || typeof data.requestId !== "string") return;
        try {
          if (data.action === "ping") {
            const workspaces = ctx.get("workspaces");
            if (workspaces?.list.getSnapshot().phase === "ready") window.parent.postMessage({ channel: "taosi-trading", ready: true }, "*");
            return;
          } else if (data.action === "settings") {
            const shell = ctx.slots.entries("sidebar.settings")[0]?.store?.create();
            if (!shell?.actions?.openSection) throw new Error("交易配置页面尚未就绪");
            shell.actions.openSection("trading");
          } else if (data.action === "example" && Object.hasOwn(examples, data.example)) {
            const workspaces = ctx.get("workspaces");
            if (!workspaces || workspaces.list.getSnapshot().phase !== "ready") throw new Error("工作区仍在加载，请稍后重试");
            const workspaceId = workspaces.list.getSnapshot().items[0]?.workspaceId ?? (await workspaces.initializeDefault())?.workspaceId;
            if (!workspaceId) throw new Error("无法初始化分析工作区");
            let prepared = false;
            await ctx.get("uiWorkspace").openWorkspace(workspaceId, (id) => {
              const binding = ctx.get("sessions").binding(id);
              if (!binding || ctx.get("conversation").input.requestDraftInitialization(binding, {
                prompt: examples[data.example], clearPreviousDraft: false,
              }) === "blocked") throw new Error("无法准备分析草稿");
              prepared = true;
            });
            if (!prepared) throw new Error("分析工作区导航被取消，请重试");
          } else return;
          reply(data.requestId, true);
        } catch (error) { reply(data.requestId, false, error.message ?? String(error)); }
      };
      window.addEventListener("message", onMessage);
      ctx.on("dispose", () => window.removeEventListener("message", onMessage));
    },
  }),
});
