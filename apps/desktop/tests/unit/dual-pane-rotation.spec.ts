import { expect, test } from "@playwright/test";
import { computeDualPanePartner, type DualPaneCandidateSession } from "../../src/dual-pane-rotation";

test.describe("computeDualPanePartner", () => {
  const sessionA: DualPaneCandidateSession = {
    id: "session-a",
    updatedAt: "2026-09-18T12:00:00Z", // Newest
  };

  const sessionB: DualPaneCandidateSession = {
    id: "session-b",
    updatedAt: "2026-09-18T11:00:00Z", // 2nd newest
  };

  const sessionC: DualPaneCandidateSession = {
    id: "session-c",
    updatedAt: "2026-09-18T10:00:00Z", // 3rd newest
  };

  const archivedSession: DualPaneCandidateSession = {
    id: "session-archived",
    updatedAt: "2026-09-18T13:00:00Z",
    archivedAt: "2026-09-18T13:05:00Z",
  };

  test("rotates between the 2 newest active sessions when newest is selected", () => {
    const sessions = [sessionC, sessionA, sessionB];
    const partner = computeDualPanePartner(sessionA, sessions);
    expect(partner?.id).toBe(sessionB.id);
  });

  test("rotates between the 2 newest active sessions when 2nd newest is selected", () => {
    const sessions = [sessionC, sessionA, sessionB];
    const partner = computeDualPanePartner(sessionB, sessions);
    expect(partner?.id).toBe(sessionA.id);
  });

  test("pairs an older active session with the newest active session", () => {
    const sessions = [sessionC, sessionA, sessionB];
    const partner = computeDualPanePartner(sessionC, sessions);
    expect(partner?.id).toBe(sessionA.id);
  });

  test("strictly returns undefined when the selected session is archived (single-pane only)", () => {
    const sessions = [sessionA, sessionB, archivedSession];
    const partner = computeDualPanePartner(archivedSession, sessions);
    expect(partner).toBeUndefined();
  });

  test("never selects an archived session as a dual-pane partner", () => {
    const sessions = [sessionA, archivedSession];
    const partner = computeDualPanePartner(sessionA, sessions);
    // Only 1 active session (sessionA), archivedSession must not be chosen
    expect(partner).toBeUndefined();
  });

  test("ignores archived sessions when picking the 2 newest active sessions", () => {
    // Even if archivedSession has the latest timestamp, active sessions are A and B
    const sessions = [archivedSession, sessionA, sessionB, sessionC];
    const partnerA = computeDualPanePartner(sessionA, sessions);
    expect(partnerA?.id).toBe(sessionB.id);

    const partnerB = computeDualPanePartner(sessionB, sessions);
    expect(partnerB?.id).toBe(sessionA.id);
  });

  test("returns undefined when workspace has fewer than 2 active sessions", () => {
    expect(computeDualPanePartner(sessionA, [sessionA])).toBeUndefined();
    expect(computeDualPanePartner(sessionA, [])).toBeUndefined();
    expect(computeDualPanePartner(undefined, [sessionA, sessionB])).toBeUndefined();
  });

  test("respects explicit companion session pairing when available", () => {
    const piSession: DualPaneCandidateSession = {
      id: "pi-1",
      backendId: "pi",
      updatedAt: "2026-09-18T12:00:00Z",
    };
    const fxCompanion: DualPaneCandidateSession = {
      id: "fx-1",
      backendId: "fx",
      companionSessionId: "pi-1",
      updatedAt: "2026-09-18T10:00:00Z",
    };
    const regularSession: DualPaneCandidateSession = {
      id: "pi-regular",
      backendId: "pi",
      updatedAt: "2026-09-18T11:00:00Z",
    };

    const partner = computeDualPanePartner(piSession, [piSession, regularSession, fxCompanion], {
      fxAvailable: true,
    });
    expect(partner?.id).toBe(fxCompanion.id);
  });
});
