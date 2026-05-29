import { scopeThreadRef } from "@t3tools/client-runtime";
import { useNavigate } from "@tanstack/react-router";
import { ActivityIcon, BotIcon, ListTodoIcon, TerminalIcon, WrenchIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  deriveBackgroundWorkItems,
  type BackgroundWorkItem,
  type BackgroundWorkKind,
} from "../backgroundWork";
import { selectThreadsAcrossEnvironments, useStore } from "../store";
import { useTerminalStateStore } from "../terminalStateStore";
import { formatElapsedDurationLabel } from "../timestampFormat";
import { buildThreadRouteParams } from "../threadRoutes";
import { Button } from "./ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";

const KIND_LABELS: Record<BackgroundWorkKind, string> = {
  turn: "Agent",
  tool: "Tool",
  task: "Task",
  terminal: "Terminal",
};

const KIND_ICONS = {
  turn: BotIcon,
  tool: WrenchIcon,
  task: ListTodoIcon,
  terminal: TerminalIcon,
} satisfies Record<BackgroundWorkKind, typeof ActivityIcon>;

function useNowTick(intervalMs: number, enabled: boolean): number {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;
    setNowMs(Date.now());
    const intervalId = globalThis.setInterval(() => {
      setNowMs(Date.now());
    }, intervalMs);

    return () => {
      globalThis.clearInterval(intervalId);
    };
  }, [enabled, intervalMs]);

  return nowMs;
}

export function BackgroundWorkIndicator() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const threads = useStore(useShallow(selectThreadsAcrossEnvironments));
  const terminalStateByThreadKey = useTerminalStateStore((state) => state.terminalStateByThreadKey);
  const setTerminalOpen = useTerminalStateStore((state) => state.setTerminalOpen);
  const setActiveTerminal = useTerminalStateStore((state) => state.setActiveTerminal);
  const items = useMemo(
    () => deriveBackgroundWorkItems({ threads, terminalStateByThreadKey }),
    [terminalStateByThreadKey, threads],
  );
  const nowMs = useNowTick(1_000, items.length > 0);

  const handleItemClick = useCallback(
    (item: BackgroundWorkItem) => {
      const threadRef = scopeThreadRef(item.environmentId, item.threadId);
      if (item.kind === "terminal" && item.terminalId) {
        setTerminalOpen(threadRef, true);
        setActiveTerminal(threadRef, item.terminalId);
      }
      setOpen(false);
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    },
    [navigate, setActiveTerminal, setTerminalOpen],
  );

  if (items.length === 0) {
    return null;
  }

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <Button
            aria-label={`${items.length} background work items running`}
            className="h-7 w-full justify-start gap-2 rounded-md px-2 text-xs text-muted-foreground/80 hover:text-foreground [&_svg]:mx-0"
            size="sm"
            title="Background work"
            variant="ghost"
          />
        }
      >
        <ActivityIcon className="size-3.5 text-teal-600 dark:text-teal-300/90" />
        <span>{items.length} running</span>
      </PopoverTrigger>
      <PopoverPopup
        align="start"
        className="w-80 [--viewport-inline-padding:0] *:data-[slot=popover-viewport]:p-0"
        side="top"
        sideOffset={6}
      >
        <div className="border-b px-3 py-2">
          <div className="text-xs font-medium text-foreground">Running</div>
          <div className="text-[11px] text-muted-foreground">{items.length} active</div>
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {items.map((item) => (
            <BackgroundWorkItemRow
              key={item.id}
              item={item}
              nowMs={nowMs}
              onClick={handleItemClick}
            />
          ))}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function BackgroundWorkItemRow({
  item,
  nowMs,
  onClick,
}: {
  item: BackgroundWorkItem;
  nowMs: number;
  onClick: (item: BackgroundWorkItem) => void;
}) {
  const KindIcon = KIND_ICONS[item.kind];
  const elapsed = formatElapsedDurationLabel(item.startedAt, nowMs);

  return (
    <button
      type="button"
      className="flex w-full min-w-0 items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      onClick={() => onClick(item)}
    >
      <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <KindIcon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-[10px] font-medium uppercase text-muted-foreground">
            {KIND_LABELS[item.kind]}
          </span>
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {elapsed}
          </span>
        </span>
        <span className="block truncate text-xs font-medium text-foreground">
          {item.threadTitle}
        </span>
        <span
          className="block truncate text-[11px] text-muted-foreground"
          title={item.detail ?? item.label}
        >
          {item.detail ?? item.label}
        </span>
      </span>
    </button>
  );
}

export default BackgroundWorkIndicator;
