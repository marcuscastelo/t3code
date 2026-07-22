import type { ServerProvider } from "@t3tools/contracts";
import { ProviderDriverKind } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import {
  type ProviderRateLimitDetectionStatus,
  type ProviderRateLimitSnapshot,
  type ProviderRateLimitWindowSnapshot,
  deriveRateLimitPaceSnapshot,
  formatRateLimitPercent,
  formatRateLimitReset,
} from "~/lib/providerRateLimits";
import { cn } from "~/lib/utils";
import { formatProviderDriverKindLabel } from "../../providerModels";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";

type DisplayRateLimitWindow = Pick<
  ProviderRateLimitWindowSnapshot,
  "id" | "label" | "resetsAtMs" | "windowDurationMins"
> & {
  readonly usedPercent: number | null;
};

const DEFAULT_WINDOWS_BY_PROVIDER: Partial<Record<string, readonly DisplayRateLimitWindow[]>> = {
  [ProviderDriverKind.make("codex")]: [
    { id: "primary", label: "5h", usedPercent: null, resetsAtMs: null, windowDurationMins: 300 },
    {
      id: "secondary",
      label: "weekly",
      usedPercent: null,
      resetsAtMs: null,
      windowDurationMins: 10_080,
    },
  ],
  [ProviderDriverKind.make("claudeAgent")]: [
    {
      id: "five_hour",
      label: "5h",
      usedPercent: null,
      resetsAtMs: null,
      windowDurationMins: 300,
    },
    {
      id: "seven_day",
      label: "weekly",
      usedPercent: null,
      resetsAtMs: null,
      windowDurationMins: 10_080,
    },
  ],
};

function usageToneClass(usedPercent: number): string {
  if (usedPercent >= 95) return "bg-red-500";
  if (usedPercent >= 80) return "bg-amber-500";
  return "bg-muted-foreground";
}

function usageTextClass(usedPercent: number): string {
  if (usedPercent >= 95) return "text-red-600 dark:text-red-300";
  if (usedPercent >= 80) return "text-amber-700 dark:text-amber-300";
  return "text-muted-foreground";
}

function formatRemainingPercent(usedPercent: number): string {
  return formatRateLimitPercent(Math.max(0, 100 - usedPercent));
}

function formatPacePercentPoints(value: number): string {
  const absValue = Math.abs(value);
  if (absValue < 10) {
    return `${absValue.toFixed(1).replace(/\.0$/, "")}pp`;
  }
  return `${Math.round(absValue)}pp`;
}

function formatPaceDuration(minutes: number): string {
  return `${(minutes / 60).toFixed(1).replace(/\.0$/, "")}h`;
}

function formatPaceDelta(deltaPercentPoints: number, deltaDurationMins: number): string {
  return `${formatPacePercentPoints(deltaPercentPoints)} / ${formatPaceDuration(deltaDurationMins)}`;
}

function formatPaceLabel(
  deltaPercentPoints: number,
  deltaDurationMins: number,
  status: "ahead" | "on_pace" | "in_debt",
) {
  if (status === "on_pace") return "On pace";
  if (status === "ahead")
    return `Ahead by ${formatPaceDelta(deltaPercentPoints, deltaDurationMins)}`;
  return `In debt by ${formatPaceDelta(deltaPercentPoints, deltaDurationMins)}`;
}

function windowMatches(
  fallbackWindow: DisplayRateLimitWindow,
  snapshotWindow: DisplayRateLimitWindow,
): boolean {
  if (fallbackWindow.id === snapshotWindow.id) return true;
  if (fallbackWindow.label === snapshotWindow.label) return true;
  return (
    fallbackWindow.windowDurationMins !== null &&
    fallbackWindow.windowDurationMins === snapshotWindow.windowDurationMins
  );
}

function mergeWindowsWithDefaults(
  defaultWindows: readonly DisplayRateLimitWindow[],
  snapshotWindows: readonly DisplayRateLimitWindow[],
): readonly DisplayRateLimitWindow[] {
  if (defaultWindows.length === 0) return snapshotWindows.slice(0, 2);
  if (snapshotWindows.length === 0) return defaultWindows;

  const usedSnapshotIds = new Set<string>();
  const merged = defaultWindows.map((fallbackWindow) => {
    const snapshotWindow = snapshotWindows.find(
      (window) => !usedSnapshotIds.has(window.id) && windowMatches(fallbackWindow, window),
    );
    if (!snapshotWindow) return fallbackWindow;
    usedSnapshotIds.add(snapshotWindow.id);
    return {
      ...snapshotWindow,
      label: fallbackWindow.label,
    };
  });

  for (const snapshotWindow of snapshotWindows) {
    if (!usedSnapshotIds.has(snapshotWindow.id)) {
      merged.push(snapshotWindow);
    }
  }

  return merged.slice(0, 2);
}

function useDetectingLimitsLabel(active: boolean): string {
  const [dotCount, setDotCount] = useState(1);

  useEffect(() => {
    if (!active) {
      setDotCount(1);
      return;
    }

    const intervalId = window.setInterval(() => {
      setDotCount((current) => (current >= 3 ? 1 : current + 1));
    }, 500);

    return () => window.clearInterval(intervalId);
  }, [active]);

  return `Detecting limits${".".repeat(dotCount)}`;
}

function WindowMiniMeter(props: { window: DisplayRateLimitWindow; detectingLabel: string | null }) {
  const usedPercent =
    props.window.usedPercent === null ? null : Math.max(0, Math.min(100, props.window.usedPercent));
  const remainingPercent = usedPercent === null ? null : Math.max(0, 100 - usedPercent);
  const missingText = props.detectingLabel
    ? props.detectingLabel.replace("Detecting limits", "")
    : "--";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[10px] font-medium text-muted-foreground">{props.window.label}</span>
      <span className="h-1.5 w-7 overflow-hidden rounded-full bg-muted">
        <span
          className={cn(
            "block h-full rounded-full",
            usedPercent === null ? "bg-muted-foreground/30" : usageToneClass(usedPercent),
          )}
          style={{ width: `${remainingPercent ?? 100}%` }}
        />
      </span>
      <span
        className={cn(
          "w-7 text-right text-[10px] tabular-nums",
          usedPercent === null ? "text-muted-foreground/60" : usageTextClass(usedPercent),
        )}
        aria-label={usedPercent === null && props.detectingLabel ? props.detectingLabel : undefined}
      >
        {usedPercent === null ? missingText : formatRemainingPercent(usedPercent)}
      </span>
    </span>
  );
}

function WindowDetail(props: { window: DisplayRateLimitWindow; detectingLabel: string | null }) {
  const usedPercent =
    props.window.usedPercent === null ? null : Math.max(0, Math.min(100, props.window.usedPercent));
  const resetLabel = formatRateLimitReset(props.window.resetsAtMs);
  const pace =
    usedPercent === null
      ? null
      : deriveRateLimitPaceSnapshot({
          usedPercent,
          resetsAtMs: props.window.resetsAtMs,
          windowDurationMins: props.window.windowDurationMins,
        });
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-6 text-xs">
        <span className="font-medium text-foreground">{props.window.label}</span>
        <span
          className={cn(
            "tabular-nums",
            usedPercent === null ? "text-muted-foreground/60" : usageTextClass(usedPercent),
          )}
        >
          {usedPercent === null
            ? (props.detectingLabel ?? "not reported")
            : `${formatRemainingPercent(usedPercent)} left`}
        </span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            usedPercent === null ? "bg-muted-foreground/30" : usageToneClass(usedPercent),
          )}
          style={{ width: `${usedPercent === null ? 100 : Math.max(0, 100 - usedPercent)}%` }}
        />
        {pace ? (
          <div
            className="absolute top-0 h-full w-px -translate-x-1/2 bg-foreground shadow-[0_0_0_1px_hsl(var(--background))]"
            style={{ left: `${pace.expectedRemainingPercent}%` }}
            aria-label={`expected ${formatRateLimitPercent(pace.expectedRemainingPercent)} remaining`}
          />
        ) : null}
      </div>
      {pace ? (
        <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
          <span className="tabular-nums">
            expected {formatRateLimitPercent(pace.expectedRemainingPercent)}
          </span>
          <span
            className={cn(
              "tabular-nums",
              pace.status === "ahead"
                ? "text-emerald-700 dark:text-emerald-300"
                : pace.status === "in_debt"
                  ? "text-amber-700 dark:text-amber-300"
                  : "text-muted-foreground",
            )}
          >
            {formatPaceLabel(pace.deltaPercentPoints, pace.deltaDurationMins, pace.status)}
          </span>
        </div>
      ) : null}
      {resetLabel ? (
        <div className="text-xs text-muted-foreground">resets in {resetLabel}</div>
      ) : null}
    </div>
  );
}

export function ProviderRateLimitMeter(props: {
  provider: ServerProvider;
  limits: ProviderRateLimitSnapshot | null;
  detectionStatus?: ProviderRateLimitDetectionStatus;
}) {
  const { provider, limits, detectionStatus = "idle" } = props;
  const detectingLabel = useDetectingLimitsLabel(detectionStatus === "detecting");
  const defaultWindows = DEFAULT_WINDOWS_BY_PROVIDER[provider.driver] ?? [];
  if ((!limits || limits.windows.length === 0) && defaultWindows.length === 0) {
    return null;
  }

  const providerLabel =
    provider.displayName?.trim() || formatProviderDriverKindLabel(provider.driver);
  const visibleWindows = mergeWindowsWithDefaults(defaultWindows, limits?.windows ?? []);

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={0}
        render={
          <button
            type="button"
            className="inline-flex h-7 min-w-0 shrink-0 items-center gap-2 rounded-md border border-border/70 bg-card/80 px-2 text-muted-foreground transition-colors hover:border-border hover:text-foreground"
            aria-label={`${providerLabel} usage limits`}
          >
            <ProviderInstanceIcon
              driverKind={provider.driver}
              displayName={providerLabel}
              accentColor={provider.accentColor}
              className="size-4"
              iconClassName="size-4"
            />
            <span className="hidden max-w-24 truncate text-[11px] font-medium @6xl/header-actions:inline">
              {providerLabel}
            </span>
            <span className="inline-flex items-center gap-2">
              {visibleWindows.map((window) => (
                <WindowMiniMeter
                  key={window.id}
                  window={window}
                  detectingLabel={detectionStatus === "detecting" ? detectingLabel : null}
                />
              ))}
            </span>
          </button>
        }
      />
      <PopoverPopup tooltipStyle side="bottom" align="end" className="w-60 px-3 py-2.5">
        <div className="space-y-2.5">
          <div className="flex items-center gap-2">
            <ProviderInstanceIcon
              driverKind={provider.driver}
              displayName={providerLabel}
              accentColor={provider.accentColor}
              className="size-4"
              iconClassName="size-4"
            />
            <div className="min-w-0 truncate text-xs font-medium text-foreground">
              {providerLabel} limits
            </div>
          </div>
          <div className="space-y-2">
            {visibleWindows.map((window) => (
              <WindowDetail
                key={window.id}
                window={window}
                detectingLabel={detectionStatus === "detecting" ? detectingLabel : null}
              />
            ))}
          </div>
          {!limits || limits.windows.length === 0 ? (
            <div className="text-xs text-muted-foreground">
              {detectionStatus === "detecting" ? detectingLabel : "No provider limit data yet."}
            </div>
          ) : null}
          {limits?.rateLimitReachedType ? (
            <div className="text-xs text-red-600 dark:text-red-300">
              {limits.rateLimitReachedType.replace(/[_-]+/g, " ")}
            </div>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
