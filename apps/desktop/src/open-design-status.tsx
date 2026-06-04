import { useEffect, useState } from "react";
import { useT } from "./i18n";

export function OpenDesignStatusBadge() {
  const t = useT();
  const [status, setStatus] = useState<{ reachable?: boolean; version?: string; message?: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function check() {
    setLoading(true);
    try {
      const api = window.piApp;
      if (api?.getOpenDesignStatus) {
        const s = await api.getOpenDesignStatus();
        setStatus(s);
      }
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }

  async function install() {
    setLoading(true);
    try {
      const api = window.piApp;
      if (api?.installOpenDesign) {
        const result = await api.installOpenDesign();
        if (result.ok) check();
        else setStatus({ message: result.message });
      }
    } catch (e: any) {
      setStatus({ message: e.message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { check(); }, []);

  const reachable = status?.reachable;

  return (
    <div className="skill-detail__meta-list">
      <div>
        <div className="skill-detail__meta-label">{t("openDesign.daemonStatus")}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: reachable ? "#3fb950" : "#f85149",
          }} />
          <span style={{ fontSize: 13 }}>
            {loading ? t("common.loading") :
             reachable ? `${t("openDesign.daemonReady")} (v${status?.version ?? "?"})` :
             status?.message ? status.message :
             t("openDesign.daemonStopped")}
          </span>
          {!reachable && !loading ? (
            <button className="button button--secondary" style={{ marginLeft: 8, fontSize: 12, padding: "4px 10px" }}
              onClick={install}>{t("openDesign.install")}</button>
          ) : null}
          <button className="button button--secondary" style={{ fontSize: 12, padding: "4px 10px" }}
            onClick={check} disabled={loading}>{t("common.refresh")}</button>
        </div>
      </div>
    </div>
  );
}
