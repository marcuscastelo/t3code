import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { ActivityIcon, BotIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useThreadShells } from "../state/entities";
import { formatElapsedDurationLabel } from "../timestampFormat";
import { buildThreadRouteParams } from "../threadRoutes";
import { Button } from "./ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";

function useNowTick(enabled: boolean): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const intervalId = globalThis.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => globalThis.clearInterval(intervalId);
  }, [enabled]);
  return nowMs;
}

export function BackgroundWorkIndicator() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const threads = useThreadShells();
  const items = useMemo(
    () =>
      threads.flatMap((thread) => {
        const activeTurnId = thread.session?.activeTurnId;
        if (thread.session?.status !== "running" || activeTurnId === null) return [];
        return [
          {
            id: `${thread.environmentId}:${thread.id}:${activeTurnId}`,
            threadRef: scopeThreadRef(thread.environmentId, thread.id),
            title: thread.title,
            startedAt:
              (thread.latestTurn?.turnId === activeTurnId ? thread.latestTurn?.startedAt : null) ??
              thread.session.updatedAt ??
              thread.updatedAt,
          },
        ];
      }),
    [threads],
  );
  const nowMs = useNowTick(items.length > 0);
  if (items.length === 0) return null;

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <Button
            aria-label={`${items.length} background agent turns running`}
            className="h-7 w-full justify-start gap-2 rounded-md px-2 text-xs text-muted-foreground/80 hover:text-foreground"
            size="sm"
            variant="ghost"
          />
        }
      >
        <ActivityIcon className="size-3.5 text-teal-600 dark:text-teal-300/90" />
        <span>{items.length} running</span>
      </PopoverTrigger>
      <PopoverPopup align="start" className="w-80 p-0" side="top" sideOffset={6}>
        <div className="border-b px-3 py-2 text-xs font-medium">Running agent turns</div>
        <div className="max-h-80 overflow-y-auto py-1">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent"
              onClick={() => {
                setOpen(false);
                void navigate({
                  to: "/$environmentId/$threadId",
                  params: buildThreadRouteParams(item.threadRef),
                });
              }}
            >
              <BotIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{item.title}</span>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {formatElapsedDurationLabel(item.startedAt, nowMs)}
              </span>
            </button>
          ))}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
