import { scopeThreadRef } from "@t3tools/client-runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { CheckCircle2Icon, Clock3Icon, GitBranchIcon } from "lucide-react";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import type { SidebarThreadSummary } from "../../types";
import { resolveThreadStatusPill } from "../Sidebar.logic";
import {
  isReviewableThread,
  MobileStatusPill,
  ThreadDiffStat,
  useThreadGitStats,
} from "./mobileShared";

export function MobileThreadCard(props: {
  thread: SidebarThreadSummary;
  projectName: string;
  projectCwd: string;
  onOpenThread: (threadRef: ScopedThreadRef) => void;
}) {
  const { thread } = props;
  const status = resolveThreadStatusPill({ thread });
  const stats = useThreadGitStats(thread, props.projectCwd);
  const needsReview = isReviewableThread(thread);
  const updatedLabel = formatRelativeTimeLabel(
    thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt,
  );

  return (
    <button
      type="button"
      className="rounded-xl border border-border/70 bg-card/70 p-3 text-left shadow-sm shadow-black/5 transition-transform active:scale-[0.99] active:bg-accent"
      onClick={() => props.onOpenThread(scopeThreadRef(thread.environmentId, thread.id))}
    >
      <div className="flex items-start gap-2">
        <div className="line-clamp-2 min-w-0 flex-1 text-sm font-semibold leading-5">
          {thread.title}
        </div>
        {status ? <MobileStatusPill status={status} /> : null}
      </div>

      <div className="mt-2 line-clamp-1 font-mono text-[11px] text-muted-foreground/80">
        {thread.worktreePath ?? props.projectCwd}
      </div>

      <div className="mt-2.5 flex min-w-0 items-center gap-2 font-mono text-[11px] text-muted-foreground">
        <span className="inline-flex min-w-0 items-center gap-1">
          <GitBranchIcon className="size-3 shrink-0" />
          <span className="truncate">{thread.branch ?? "no branch"}</span>
        </span>
        <span className="size-1 shrink-0 rounded-full bg-muted-foreground/40" />
        <span className="inline-flex shrink-0 items-center gap-1">
          <Clock3Icon className="size-3" />
          {updatedLabel}
        </span>
        {stats ? <span className="size-1 shrink-0 rounded-full bg-muted-foreground/40" /> : null}
        {stats ? <ThreadDiffStat stats={stats} /> : null}
        {needsReview ? (
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-violet-400">
            <CheckCircle2Icon className="size-3" />
            review
          </span>
        ) : null}
      </div>
    </button>
  );
}
