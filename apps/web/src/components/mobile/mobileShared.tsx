import type { EnvironmentId } from "@t3tools/contracts";
import { CheckIcon, GitBranchIcon } from "lucide-react";
import { useVcsStatus } from "../../lib/vcsStatusState";
import type { SidebarThreadSummary } from "../../types";
import { resolveThreadStatusPill, type ThreadStatusPill } from "../Sidebar.logic";

/**
 * T3 Code Mobile — shared presentation primitives.
 *
 * These mirror the mobile design handoff (repo-colored avatars, status pills,
 * diff-stat footers and sync badges) but are wired to the app's real data:
 * per-worktree git status (`useVcsStatus`) and the shared thread status logic.
 */

// ---------------------------------------------------------------------------
// Repo colour identity
// ---------------------------------------------------------------------------

// Palette pulled from the mobile design tokens (blue / green / violet / amber /
// rose / teal). Repos get a stable colour derived from their name so the same
// project always reads with the same accent across screens.
const REPO_PALETTE = [
  { tint: "#5B9CF6", soft: "rgba(91,156,246,0.13)", ring: "rgba(91,156,246,0.22)" },
  { tint: "#46CE81", soft: "rgba(70,206,129,0.13)", ring: "rgba(70,206,129,0.22)" },
  { tint: "#A78BFA", soft: "rgba(167,139,250,0.14)", ring: "rgba(167,139,250,0.24)" },
  { tint: "#E3A24C", soft: "rgba(227,162,76,0.13)", ring: "rgba(227,162,76,0.22)" },
  { tint: "#F4716E", soft: "rgba(244,113,110,0.13)", ring: "rgba(244,113,110,0.24)" },
  { tint: "#2DD4BF", soft: "rgba(45,212,191,0.13)", ring: "rgba(45,212,191,0.22)" },
] as const;

export interface RepoVisual {
  tint: string;
  soft: string;
  ring: string;
  initial: string;
}

export function repoVisual(name: string): RepoVisual {
  const trimmed = name.trim();
  let hash = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    hash = (hash * 31 + trimmed.charCodeAt(index)) >>> 0;
  }
  const palette = REPO_PALETTE[hash % REPO_PALETTE.length] ?? REPO_PALETTE[0];
  const initial = (trimmed.replace(/^[^a-z0-9]+/i, "")[0] ?? trimmed[0] ?? "?").toUpperCase();
  return { ...palette, initial };
}

export function RepoAvatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const visual = repoVisual(name);
  const dimension = size === "lg" ? 36 : size === "sm" ? 22 : 30;
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-[9px] font-mono font-bold"
      style={{
        width: dimension,
        height: dimension,
        fontSize: Math.round(dimension * 0.42),
        color: visual.tint,
        background: visual.soft,
        border: `1px solid ${visual.ring}`,
      }}
    >
      {visual.initial}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Status pill
// ---------------------------------------------------------------------------

export function MobileStatusPill({ status }: { status: ThreadStatusPill }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-current/20 bg-current/10 px-2 py-0.5 text-[11px] font-semibold ${status.colorClass}`}
    >
      <span
        className={`size-1.5 rounded-full ${status.dotClass} ${status.pulse ? "animate-pulse" : ""}`}
      />
      {status.label}
    </span>
  );
}

export function MobileStatusDot({ thread }: { thread: SidebarThreadSummary }) {
  const status = resolveThreadStatusPill({ thread });
  if (!status) {
    return <span className="size-2.5 shrink-0 rounded-full bg-muted-foreground/35" />;
  }
  return (
    <span
      className={`size-2.5 shrink-0 rounded-full ${status.dotClass} ${status.pulse ? "animate-pulse" : ""}`}
    />
  );
}

/** Threads awaiting a human: pending approval / input / a ready plan. */
export function isReviewableThread(thread: SidebarThreadSummary): boolean {
  return (
    thread.hasPendingApprovals || thread.hasPendingUserInput || thread.hasActionableProposedPlan
  );
}

// ---------------------------------------------------------------------------
// Per-thread diff stats (working tree of the thread's worktree)
// ---------------------------------------------------------------------------

export interface ThreadGitStats {
  filesChanged: number;
  additions: number;
  deletions: number;
}

export function useThreadGitStats(
  thread: Pick<SidebarThreadSummary, "environmentId" | "branch" | "worktreePath">,
  projectCwd: string | null,
): ThreadGitStats | null {
  const cwd = thread.worktreePath ?? projectCwd;
  const status = useVcsStatus({
    environmentId: thread.environmentId,
    cwd: thread.branch != null ? cwd : null,
  });
  const workingTree = status.data?.workingTree;
  if (!workingTree || workingTree.files.length === 0) {
    return null;
  }
  return {
    filesChanged: workingTree.files.length,
    additions: workingTree.insertions,
    deletions: workingTree.deletions,
  };
}

export function ThreadDiffStat({ stats }: { stats: ThreadGitStats }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <span className="text-muted-foreground/80">
        {stats.filesChanged} {stats.filesChanged === 1 ? "file" : "files"}
      </span>
      <span className="text-success">+{stats.additions}</span>
      <span className="text-destructive">−{stats.deletions}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Project sync status (ahead / behind / synced)
// ---------------------------------------------------------------------------

export type ProjectSyncKind =
  | "synced"
  | "ahead"
  | "behind"
  | "diverged"
  | "no-upstream"
  | "unknown";

export interface ProjectSync {
  kind: ProjectSyncKind;
  aheadCount: number;
  behindCount: number;
}

export function useProjectSync(project: {
  environmentId: EnvironmentId;
  cwd: string;
}): ProjectSync {
  const status = useVcsStatus({ environmentId: project.environmentId, cwd: project.cwd });
  const data = status.data;
  if (!data || !data.isRepo) {
    return { kind: "unknown", aheadCount: 0, behindCount: 0 };
  }
  if (!data.hasUpstream) {
    return { kind: "no-upstream", aheadCount: 0, behindCount: 0 };
  }
  const aheadCount = data.aheadCount;
  const behindCount = data.behindCount;
  if (aheadCount > 0 && behindCount > 0) {
    return { kind: "diverged", aheadCount, behindCount };
  }
  if (aheadCount > 0) {
    return { kind: "ahead", aheadCount, behindCount };
  }
  if (behindCount > 0) {
    return { kind: "behind", aheadCount, behindCount };
  }
  return { kind: "synced", aheadCount, behindCount };
}

export function ProjectSyncBadge({ sync }: { sync: ProjectSync }) {
  if (sync.kind === "unknown" || sync.kind === "no-upstream") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/70 bg-card/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        <GitBranchIcon className="size-3" />
        {sync.kind === "no-upstream" ? "local" : "no git"}
      </span>
    );
  }
  if (sync.kind === "synced") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-success/25 bg-success/12 px-2 py-0.5 text-[11px] font-semibold text-success">
        <CheckIcon className="size-3" />
        synced
      </span>
    );
  }
  if (sync.kind === "ahead") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-info/25 bg-info/12 px-2 py-0.5 text-[11px] font-semibold text-info">
        ↑{sync.aheadCount} ahead
      </span>
    );
  }
  if (sync.kind === "behind") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-warning/25 bg-warning/12 px-2 py-0.5 text-[11px] font-semibold text-warning">
        ↓{sync.behindCount} behind
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-warning/25 bg-warning/12 px-2 py-0.5 text-[11px] font-semibold text-warning">
      ↑{sync.aheadCount} ↓{sync.behindCount}
    </span>
  );
}
