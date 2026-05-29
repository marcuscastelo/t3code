import { describe, expect, it } from "vitest";
import {
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";

import {
  deriveRateLimitPaceSnapshot,
  deriveLatestProviderRateLimitSnapshot,
  deriveProviderRateLimitSnapshotFromValue,
  formatRateLimitPercent,
  formatRateLimitReset,
  shouldRefreshProviderRateLimits,
} from "./providerRateLimits";

function makeActivity(
  id: string,
  payload: unknown,
  createdAt = "2026-03-23T00:00:00.000Z",
): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    tone: "info",
    kind: "account.rate-limits.updated",
    summary: "Account rate limits updated",
    payload,
    turnId: null,
    createdAt,
  };
}

describe("providerRateLimits", () => {
  it("derives Codex five-hour and weekly windows", () => {
    const snapshot = deriveLatestProviderRateLimitSnapshot(
      [
        makeActivity("activity-1", {
          provider: "codex",
          providerInstanceId: "codex",
          rateLimits: {
            primary: {
              usedPercent: 42,
              windowDurationMins: 300,
              resetsAt: 1_778_000_000,
            },
            secondary: {
              usedPercent: 71,
              windowDurationMins: 10_080,
            },
          },
        }),
      ],
      {
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: ProviderInstanceId.make("codex"),
      },
    );

    expect(snapshot?.windows).toMatchObject([
      { label: "5h", usedPercent: 42, resetsAtMs: 1_778_000_000_000 },
      { label: "weekly", usedPercent: 71 },
    ]);
  });

  it("unwraps nested rateLimits payloads", () => {
    const snapshot = deriveLatestProviderRateLimitSnapshot([
      makeActivity("activity-1", {
        rateLimits: {
          rateLimits: {
            primary: {
              usedPercent: 12,
              windowDurationMins: 300,
            },
          },
        },
      }),
    ]);

    expect(snapshot?.windows[0]?.label).toBe("5h");
    expect(snapshot?.windows[0]?.usedPercent).toBe(12);
  });

  it("derives limits from Codex provider snapshots", () => {
    const snapshot = deriveProviderRateLimitSnapshotFromValue(
      {
        rateLimits: {
          primary: {
            usedPercent: 23,
            windowDurationMins: 300,
          },
          secondary: {
            usedPercent: 5,
            windowDurationMins: 10_080,
          },
        },
      },
      {
        provider: "codex",
        providerInstanceId: "codex",
        updatedAt: "2026-03-23T00:00:00.000Z",
      },
    );

    expect(snapshot?.windows).toMatchObject([
      { label: "5h", usedPercent: 23 },
      { label: "weekly", usedPercent: 5 },
    ]);
  });

  it("derives Claude SDK rate-limit events", () => {
    const snapshot = deriveLatestProviderRateLimitSnapshot([
      makeActivity("activity-1", {
        provider: "claudeAgent",
        rateLimits: {
          type: "rate_limit_event",
          rate_limit_info: {
            status: "allowed",
            rateLimitType: "five_hour",
            utilization: 0.25,
            resetsAt: 1_778_000_000,
          },
        },
      }),
      makeActivity("activity-2", {
        provider: "claudeAgent",
        rateLimits: {
          type: "rate_limit_event",
          rate_limit_info: {
            status: "allowed",
            rateLimitType: "seven_day",
            utilization: 50,
          },
        },
      }),
    ]);

    expect(snapshot?.windows).toMatchObject([
      { label: "5h", usedPercent: 25, resetsAtMs: 1_778_000_000_000 },
      { label: "weekly", usedPercent: 50 },
    ]);
  });

  it("asks for refresh when an expected provider window is missing", () => {
    expect(
      shouldRefreshProviderRateLimits(
        {
          provider: "claudeAgent",
          providerInstanceId: "claude",
          windows: [
            {
              id: "five_hour",
              label: "5h",
              usedPercent: 0,
              resetsAtMs: null,
              windowDurationMins: 300,
            },
          ],
          rateLimitReachedType: null,
          updatedAt: "2026-03-23T00:00:00.000Z",
        },
        ProviderDriverKind.make("claudeAgent"),
      ),
    ).toBe(true);
    expect(
      shouldRefreshProviderRateLimits(
        {
          provider: "claudeAgent",
          providerInstanceId: "claude",
          windows: [
            {
              id: "five_hour",
              label: "5h",
              usedPercent: 0,
              resetsAtMs: null,
              windowDurationMins: 300,
            },
            {
              id: "seven_day",
              label: "weekly",
              usedPercent: 10,
              resetsAtMs: null,
              windowDurationMins: 10_080,
            },
          ],
          rateLimitReachedType: null,
          updatedAt: "2026-03-23T00:00:00.000Z",
        },
        ProviderDriverKind.make("claudeAgent"),
      ),
    ).toBe(false);
  });

  it("filters provider mismatches", () => {
    const snapshot = deriveLatestProviderRateLimitSnapshot(
      [
        makeActivity("activity-1", {
          provider: "claudeAgent",
          rateLimits: {
            primary: { usedPercent: 50, windowDurationMins: 300 },
          },
        }),
      ],
      { provider: ProviderDriverKind.make("codex") },
    );

    expect(snapshot).toBeNull();
  });

  it("formats compact percentages and reset durations", () => {
    expect(formatRateLimitPercent(9.25)).toBe("9.3%");
    expect(formatRateLimitPercent(42.2)).toBe("42%");
    expect(formatRateLimitReset(1_000 + 90 * 60_000, 1_000)).toBe("2h");
    expect(formatRateLimitReset(1_000 - 1, 1_000)).toBe("now");
  });

  it("derives linear pacing from reset time and window duration", () => {
    const nowMs = Date.UTC(2026, 2, 23, 0, 0, 0);
    const resetsAtMs = nowMs + 150 * 60_000;

    expect(
      deriveRateLimitPaceSnapshot(
        {
          usedPercent: 8,
          resetsAtMs,
          windowDurationMins: 300,
        },
        nowMs,
      ),
    ).toMatchObject({
      expectedRemainingPercent: 50,
      deltaPercentPoints: 42,
      deltaDurationMins: 126,
      status: "ahead",
    });

    expect(
      deriveRateLimitPaceSnapshot(
        {
          usedPercent: 70,
          resetsAtMs,
          windowDurationMins: 300,
        },
        nowMs,
      ),
    ).toMatchObject({
      expectedRemainingPercent: 50,
      deltaPercentPoints: -20,
      deltaDurationMins: 60,
      status: "in_debt",
    });

    expect(
      deriveRateLimitPaceSnapshot(
        {
          usedPercent: 51,
          resetsAtMs,
          windowDurationMins: 300,
        },
        nowMs,
      ),
    ).toMatchObject({
      expectedRemainingPercent: 50,
      deltaPercentPoints: -1,
      deltaDurationMins: 3,
      status: "on_pace",
    });
  });

  it("skips pacing when reset or duration is missing", () => {
    expect(
      deriveRateLimitPaceSnapshot({
        usedPercent: 50,
        resetsAtMs: null,
        windowDurationMins: 300,
      }),
    ).toBeNull();
    expect(
      deriveRateLimitPaceSnapshot({
        usedPercent: 50,
        resetsAtMs: 1_778_000_000_000,
        windowDurationMins: null,
      }),
    ).toBeNull();
  });
});
