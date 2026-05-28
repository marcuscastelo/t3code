import type {
  OrchestrationThreadActivity,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(
  record: Record<string, unknown> | null,
  keys: readonly string[],
): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = asFiniteNumber(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function readString(
  record: Record<string, unknown> | null,
  keys: readonly string[],
): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = asString(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function normalizePercent(value: number | null): number | null {
  if (value === null) return null;
  const percent = value >= 0 && value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, percent));
}

function normalizeResetAtMs(value: number | null): number | null {
  if (value === null || value <= 0) return null;
  return value < 10_000_000_000 ? value * 1000 : value;
}

function hasWindowShape(record: Record<string, unknown> | null): boolean {
  if (!record) return false;
  return (
    asRecord(record.primary) !== null ||
    asRecord(record.secondary) !== null ||
    asArray(record.limits) !== null ||
    asArray(record.rate_limits) !== null ||
    asArray(record.windows) !== null
  );
}

function unwrapRateLimits(value: unknown): Record<string, unknown> | null {
  let current = asRecord(value);
  for (let index = 0; index < 4; index += 1) {
    if (!current) return null;
    if (hasWindowShape(current)) return current;
    const nested = asRecord(current.rateLimits) ?? asRecord(current.rate_limits);
    if (!nested) return current;
    current = nested;
  }
  return current;
}

function formatDurationLabel(minutes: number | null, fallback: string): string {
  if (minutes === null || minutes <= 0) return fallback;
  if (minutes >= 10_000 && minutes <= 10_200) return "weekly";
  if (minutes === 300) return "5h";
  if (minutes % 1440 === 0) return `${Math.round(minutes / 1440)}d`;
  if (minutes % 60 === 0) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes)}m`;
}

function normalizeWindowLabel(label: string | null, minutes: number | null, fallback: string) {
  const normalized = label?.toLowerCase().replace(/[_-]+/g, " ").trim() ?? "";
  if (normalized.includes("week")) return "weekly";
  if (normalized.includes("5h") || normalized.includes("5 hour")) return "5h";
  if (normalized) return label ?? normalized;
  return formatDurationLabel(minutes, fallback);
}

function claudeWindowDefaults(type: string | null): {
  readonly id: string;
  readonly label: string;
  readonly windowDurationMins: number | null;
} {
  switch (type) {
    case "five_hour":
      return { id: "five_hour", label: "5h", windowDurationMins: 300 };
    case "seven_day_opus":
      return { id: "seven_day_opus", label: "weekly opus", windowDurationMins: 10_080 };
    case "seven_day_sonnet":
      return { id: "seven_day_sonnet", label: "weekly sonnet", windowDurationMins: 10_080 };
    case "seven_day":
      return { id: "seven_day", label: "weekly", windowDurationMins: 10_080 };
    case "overage":
      return { id: "overage", label: "overage", windowDurationMins: null };
    default:
      return { id: "claude", label: "limit", windowDurationMins: null };
  }
}

export interface ProviderRateLimitWindowSnapshot {
  readonly id: string;
  readonly label: string;
  readonly usedPercent: number;
  readonly resetsAtMs: number | null;
  readonly windowDurationMins: number | null;
}

export interface ProviderRateLimitSnapshot {
  readonly provider: string | null;
  readonly providerInstanceId: string | null;
  readonly windows: readonly ProviderRateLimitWindowSnapshot[];
  readonly rateLimitReachedType: string | null;
  readonly updatedAt: string;
}

function parseRateLimitWindow(
  id: string,
  value: unknown,
  fallbackLabel: string,
): ProviderRateLimitWindowSnapshot | null {
  const record = asRecord(value);
  if (!record) return null;
  const usedPercent = normalizePercent(
    readNumber(record, [
      "usedPercent",
      "used_percent",
      "usagePercent",
      "usage_percent",
      "percent",
      "percentage",
    ]),
  );
  if (usedPercent === null) return null;
  const windowDurationMins = readNumber(record, [
    "windowDurationMins",
    "window_duration_mins",
    "windowMinutes",
    "window_minutes",
    "durationMins",
    "duration_mins",
    "durationMinutes",
    "duration_minutes",
  ]);
  const label = normalizeWindowLabel(
    readString(record, ["label", "name", "limitName", "limit_name", "window", "windowLabel"]),
    windowDurationMins,
    fallbackLabel,
  );
  return {
    id,
    label,
    usedPercent,
    resetsAtMs: normalizeResetAtMs(
      readNumber(record, ["resetsAt", "resets_at", "resetAt", "reset_at", "resetTime"]),
    ),
    windowDurationMins,
  };
}

function windowsFromRoot(root: Record<string, unknown>): ProviderRateLimitWindowSnapshot[] {
  const windows: ProviderRateLimitWindowSnapshot[] = [];
  const pushWindow = (window: ProviderRateLimitWindowSnapshot | null) => {
    if (!window) return;
    if (windows.some((entry) => entry.id === window.id || entry.label === window.label)) return;
    windows.push(window);
  };

  pushWindow(parseRateLimitWindow("primary", root.primary, "5h"));
  pushWindow(parseRateLimitWindow("secondary", root.secondary, "weekly"));

  const claudeRateLimitInfo = asRecord(root.rate_limit_info) ?? asRecord(root.rateLimitInfo);
  if (claudeRateLimitInfo) {
    const type = readString(claudeRateLimitInfo, ["rateLimitType", "rate_limit_type"]);
    const defaults = claudeWindowDefaults(type);
    pushWindow({
      id: defaults.id,
      label: defaults.label,
      usedPercent:
        normalizePercent(readNumber(claudeRateLimitInfo, ["utilization", "usedPercent"])) ?? 0,
      resetsAtMs: normalizeResetAtMs(
        readNumber(claudeRateLimitInfo, ["resetsAt", "resets_at", "resetAt"]),
      ),
      windowDurationMins: defaults.windowDurationMins,
    });
  }

  for (const key of ["limits", "rate_limits", "windows"] as const) {
    const entries = asArray(root[key]);
    if (!entries) continue;
    entries.forEach((entry, index) =>
      pushWindow(parseRateLimitWindow(`${key}:${index}`, entry, `limit ${index + 1}`)),
    );
  }

  return windows.toSorted((left, right) => {
    const leftDuration = left.windowDurationMins ?? Number.POSITIVE_INFINITY;
    const rightDuration = right.windowDurationMins ?? Number.POSITIVE_INFINITY;
    return leftDuration - rightDuration;
  });
}

function snapshotFromRateLimitValue(
  value: unknown,
  input: {
    readonly provider?: ProviderDriverKind | string | null | undefined;
    readonly providerInstanceId?: ProviderInstanceId | string | null | undefined;
    readonly updatedAt: string;
  },
): ProviderRateLimitSnapshot | null {
  const root = unwrapRateLimits(value);
  if (!root) return null;
  const windows = windowsFromRoot(root);
  if (windows.length === 0) return null;
  return {
    provider: input.provider ? String(input.provider) : null,
    providerInstanceId: input.providerInstanceId ? String(input.providerInstanceId) : null,
    windows,
    rateLimitReachedType: readString(root, ["rateLimitReachedType", "rate_limit_reached_type"]),
    updatedAt: input.updatedAt,
  };
}

function activityProviderMatches(
  payload: Record<string, unknown> | null,
  filter: {
    readonly provider?: ProviderDriverKind | null | undefined;
    readonly providerInstanceId?: ProviderInstanceId | null | undefined;
  },
): boolean {
  const activityProvider = readString(payload, ["provider"]);
  const activityProviderInstanceId = readString(payload, ["providerInstanceId"]);

  if (
    activityProviderInstanceId &&
    filter.providerInstanceId &&
    activityProviderInstanceId !== filter.providerInstanceId
  ) {
    return false;
  }
  if (activityProvider && filter.provider && activityProvider !== filter.provider) {
    return false;
  }
  return true;
}

export function deriveLatestProviderRateLimitSnapshot(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  filter: {
    readonly provider?: ProviderDriverKind | null | undefined;
    readonly providerInstanceId?: ProviderInstanceId | null | undefined;
  } = {},
): ProviderRateLimitSnapshot | null {
  const windowsById = new Map<string, ProviderRateLimitWindowSnapshot>();
  let latest: {
    readonly provider: string | null;
    readonly providerInstanceId: string | null;
    readonly rateLimitReachedType: string | null;
    readonly updatedAt: string;
  } | null = null;

  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (!activity || activity.kind !== "account.rate-limits.updated") {
      continue;
    }

    const payload = asRecord(activity.payload);
    if (!activityProviderMatches(payload, filter)) {
      continue;
    }

    const snapshot = snapshotFromRateLimitValue(payload?.rateLimits ?? activity.payload, {
      provider: readString(payload, ["provider"]),
      providerInstanceId: readString(payload, ["providerInstanceId"]),
      updatedAt: activity.createdAt,
    });
    if (!snapshot) {
      continue;
    }

    if (!latest) {
      latest = {
        provider: snapshot.provider,
        providerInstanceId: snapshot.providerInstanceId,
        rateLimitReachedType: snapshot.rateLimitReachedType,
        updatedAt: snapshot.updatedAt,
      };
    }
    for (const window of snapshot.windows) {
      if (!windowsById.has(window.id)) {
        windowsById.set(window.id, window);
      }
    }
    if (windowsById.size >= 2) break;
  }

  if (!latest || windowsById.size === 0) return null;
  return {
    ...latest,
    windows: [...windowsById.values()].toSorted((left, right) => {
      const leftDuration = left.windowDurationMins ?? Number.POSITIVE_INFINITY;
      const rightDuration = right.windowDurationMins ?? Number.POSITIVE_INFINITY;
      return leftDuration - rightDuration;
    }),
  };
}

export function deriveProviderRateLimitSnapshotFromValue(
  value: unknown,
  input: {
    readonly provider?: ProviderDriverKind | string | null | undefined;
    readonly providerInstanceId?: ProviderInstanceId | string | null | undefined;
    readonly updatedAt: string;
  },
): ProviderRateLimitSnapshot | null {
  return snapshotFromRateLimitValue(value, input);
}

export function formatRateLimitPercent(value: number): string {
  if (value < 10) {
    return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  }
  return `${Math.round(value)}%`;
}

export function formatRateLimitReset(resetsAtMs: number | null, nowMs = Date.now()): string | null {
  if (resetsAtMs === null) return null;
  const remainingMs = resetsAtMs - nowMs;
  if (remainingMs <= 0) return "now";
  const remainingMinutes = Math.ceil(remainingMs / 60_000);
  if (remainingMinutes < 60) return `${remainingMinutes}m`;
  const remainingHours = Math.ceil(remainingMinutes / 60);
  if (remainingHours < 48) return `${remainingHours}h`;
  return `${Math.ceil(remainingHours / 24)}d`;
}
