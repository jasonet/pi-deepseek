import { useMemo, useState } from "react";
import catalog from "./mcp-catalog.json";

export function McpCatalogView() {
  const [query, setQuery] = useState("");
  const entries = useMemo(() => {
    const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return catalog.entries.filter((entry) => {
      const text = `${entry.name} ${entry.category} ${entry.description} ${entry.tags}`.toLocaleLowerCase();
      return terms.every((term) => text.includes(term));
    });
  }, [query]);
  return <section aria-label="MCP 目录">
    <p className="view-header__body">浏览开源 MCP 服务。目录仅供参考，服务不会自动安装或启用。</p>
    <div className="skills-toolbar">
      <input className="skills-search" aria-label="搜索 MCP 目录" placeholder="搜索名称、分类或功能" value={query} onChange={(event) => setQuery(event.target.value)} />
    </div>
    <p>{entries.length} 个结果 · 来源 awesome-mcp-servers · {catalog.revision.slice(0, 8)}</p>
    <div className="settings-group">
      {entries.slice(0, 100).map((entry) => <div className="settings-row" key={`${entry.category}:${entry.url}`}>
        <div className="settings-row__label"><div className="settings-row__title">{entry.name}</div>
          <div className="settings-row__description">{entry.category} · {entry.tags} {entry.description}</div></div>
        <button className="button button--secondary" type="button" onClick={() => void window.piApp?.openExternal(entry.url)}>查看源码</button>
      </div>)}
    </div>
    {entries.length > 100 ? <p>显示前 100 项，请使用搜索缩小范围。</p> : null}
  </section>;
}
