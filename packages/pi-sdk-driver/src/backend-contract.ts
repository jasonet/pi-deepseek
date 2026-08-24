import type { SessionCatalogEntry } from "@pi-gui/catalogs";
import type { SessionSnapshot } from "@pi-gui/session-driver";

export const PI_BACKEND_ID: SessionCatalogEntry["backendId"] &
  SessionSnapshot["backendId"] = "pi";
