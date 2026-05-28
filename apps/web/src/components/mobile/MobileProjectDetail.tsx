import type { ScopedThreadRef } from "@t3tools/contracts";
import { ArrowLeftIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import { refreshGitStatus } from "../../lib/gitStatusState";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import type { SidebarThreadSummary } from "../../types";
import { Button } from "../ui/button";
import { MobileThreadCard } from "./MobileThreadCard";
import { ProjectSyncBadge, RepoAvatar, useProjectSync } from "./mobileShared";

function isActiveThread(thread: SidebarThreadSummary) {
  return thread.session?.status === "running" || thread.session?.status === "connecting";
}

export function MobileProjectDetail(props: {
  project: SidebarProjectSnapshot;
  threads: SidebarThreadSummary[];
  onBack: () => void;
  onNewTask: () => void;
  onOpenThread: (threadRef: ScopedThreadRef) => void;
}) {
  const { project, threads } = props;
  const sync = useProjectSync(project);
  const [syncing, setSyncing] = useState(false);
  const active = threads.filter(isActiveThread);
  const recent = threads.filter((thread) => !isActiveThread(thread));
  const headerBranch = threads[0]?.branch ?? project.cwd.split("/").pop() ?? project.cwd;

  const handleSync = async () => {
    setSyncing(true);
    try {
      await refreshGitStatus({ environmentId: project.environmentId, cwd: project.cwd });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-background">
      <header className="shrink-0 border-b border-border/70 bg-background/92 px-3 pb-3 pt-[calc(env(safe-area-inset-top)+0.5rem)] backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Back"
            className="grid size-9 shrink-0 place-items-center rounded-lg border border-border/70 bg-card/70 text-muted-foreground active:bg-accent active:text-foreground"
            onClick={props.onBack}
          >
            <ArrowLeftIcon className="size-4" />
          </button>
          <RepoAvatar name={project.displayName} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{project.displayName}</div>
            <div className="flex min-w-0 items-center gap-1.5 truncate font-mono text-[11px] text-muted-foreground">
              <span className="truncate">{headerBranch}</span>
            </div>
          </div>
          <ProjectSyncBadge sync={sync} />
        </div>

        <div className="mt-3 flex gap-2">
          <Button className="h-9 flex-1 rounded-lg" size="sm" onClick={props.onNewTask}>
            <PlusIcon className="size-4" />
            New task
          </Button>
          <Button
            className="h-9 rounded-lg"
            size="sm"
            variant="outline"
            disabled={syncing}
            onClick={() => void handleSync()}
          >
            <RefreshCwIcon className={`size-4 ${syncing ? "animate-spin" : ""}`} />
            Sync
          </Button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {threads.length === 0 ? (
          <div className="rounded-xl border border-border/60 bg-card/35 px-4 py-10 text-center text-sm text-muted-foreground">
            No threads in this project yet.
          </div>
        ) : (
          <div className="flex flex-col gap-5 pb-4">
            {active.length > 0 ? (
              <section className="flex flex-col gap-2.5">
                <SectionHeader label="Active agents" count={active.length} />
                <div className="flex flex-col gap-2">
                  {active.map((thread) => (
                    <MobileThreadCard
                      key={thread.id}
                      thread={thread}
                      projectName={project.displayName}
                      projectCwd={project.cwd}
                      onOpenThread={props.onOpenThread}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            <section className="flex flex-col gap-2.5">
              <SectionHeader label="Recent work" count={recent.length} />
              {recent.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {recent.map((thread) => (
                    <MobileThreadCard
                      key={thread.id}
                      thread={thread}
                      projectName={project.displayName}
                      projectCwd={project.cwd}
                      onOpenThread={props.onOpenThread}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-border/60 bg-card/35 px-3 py-4 text-center text-sm text-muted-foreground">
                  No completed threads yet
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-0.5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </h2>
      <span className="font-mono text-[11px] text-muted-foreground/70">{count}</span>
    </div>
  );
}
