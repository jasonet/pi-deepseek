import { useEffect, useState } from "react";
import { useT } from "./i18n";

export function ProviderBalance({ providerId, hasAuth }: { providerId: string; hasAuth: boolean }) {
  const t = useT();
  const [balance, setBalance] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!hasAuth || providerId !== "deepseek") return;
    const api = window.piApp;
    if (!api?.getProviderBalance) return;

    api.getProviderBalance(providerId).then((result) => {
      if ("balance" in result) {
        setBalance(result.balance);
      } else {
        setError(true);
      }
    }).catch(() => setError(true));
  }, [providerId, hasAuth]);

  if (!balance && !error) return null;
  if (error) return null;
  if (balance == null) return null;

  const num = parseFloat(balance);
  const display = isNaN(num) ? balance : `${num.toFixed(1)} CNY`;

  return (
    <span style={{ fontSize: 12, color: "#3fb950", fontWeight: 500, marginLeft: 6 }}>
      · {t("settings.providers.balance")} ¥{display.replace(" CNY", "")}
    </span>
  );
}
