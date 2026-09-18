export interface DualPaneCandidateSession {
  readonly id: string;
  readonly updatedAt: string;
  readonly archivedAt?: string;
  readonly backendId?: string;
  readonly companionSessionId?: string;
}

/**
 * Computes the companion partner session in dual-pane mode.
 *
 * Rules:
 * 1. An archived session must NEVER enter dual-pane mode (neither as primary nor as secondary).
 * 2. If the selected session is archived, returns undefined (forces single-pane mode).
 * 3. Rotates between the 2 latest active (non-archived) sessions:
 *    - If the selected session is the newest (activeSessions[0]), the partner is the 2nd newest (activeSessions[1]).
 *    - If the selected session is the 2nd newest (or an older active session being inspected), the partner is the newest (activeSessions[0]).
 * 4. Requires at least 2 active sessions in the workspace; otherwise returns undefined (single-pane only).
 */
export function computeDualPanePartner<T extends DualPaneCandidateSession>(
  selectedSession: T | undefined,
  sessions: readonly T[],
  options?: { readonly fxAvailable?: boolean },
): T | undefined {
  if (!selectedSession || Boolean(selectedSession.archivedAt)) {
    return undefined;
  }

  // Filter strictly to non-archived sessions in this workspace, sorted by updatedAt descending
  const activeSessions = [...sessions]
    .filter(
      (session) =>
        !session.archivedAt &&
        (options?.fxAvailable || session.backendId !== "fx"),
    )
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  if (activeSessions.length < 2) {
    return undefined;
  }

  // Check for explicit companion pair if present
  const pairedCandidate =
    selectedSession.backendId === "pi"
      ? activeSessions.find(
          (candidate) => candidate.backendId === "fx" && candidate.companionSessionId === selectedSession.id,
        )
      : activeSessions.find((candidate) => candidate.id === selectedSession.companionSessionId);

  if (pairedCandidate && !pairedCandidate.archivedAt && pairedCandidate.id !== selectedSession.id) {
    return pairedCandidate;
  }

  const partner =
    selectedSession.id === activeSessions[0]?.id
      ? activeSessions[1]
      : activeSessions[0];

  if (!partner || partner.archivedAt || partner.id === selectedSession.id) {
    return undefined;
  }

  return partner;
}
