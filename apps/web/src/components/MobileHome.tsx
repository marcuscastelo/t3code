import {
  ActivityIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  FolderGit2Icon,
  GitBranchIcon,
  MessageSquareIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime";
import type { ProjectId, ScopedProjectRef, ScopedThreadRef } from "@t3tools/contracts";

import { APP_BASE_NAME, APP_STAGE_LABEL } from "../branding";
import { useCommandPaletteStore } from "../commandPaletteStore";
import {
  useSavedEnvironmentRegistryStore,
  useSavedEnvironmentRuntimeStore,
} from "../environments/runtime";
import { usePrimaryEnvironmentId } from "../environments/primary";
import { useSettings } from "../hooks/useSettings";
import { sortThreads } from "../lib/threadSort";
import { formatRelativeTimeLabel } from "../timestampFormat";
import {
  derivePhysicalProjectKey,
  getProjectOrderKey,
  selectProjectGroupingSettings,
} from "../logicalProject";
import {
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsAcrossEnvironments,
  useStore,
} from "../store";
import { useUiStateStore } from "../uiStateStore";
import {
  buildPhysicalToLogicalProjectKeyMap,
  buildSidebarProjectSnapshots,
  type SidebarProjectSnapshot,
} from "../sidebarProjectGrouping";
import type { SidebarThreadSummary } from "../types";
import { orderItemsByPreferredIds, sortProjectsForSidebar } from "./Sidebar.logic";
import { Button } from "./ui/button";
import { SidebarInset, SidebarTrigger } from "./ui/sidebar";
import { MobileThreadCard } from "./mobile/MobileThreadCard";
import { MobileProjectDetail } from "./mobile/MobileProjectDetail";
import { MobileSettings } from "./mobile/MobileSettings";
import { MobileNewTaskSheet } from "./mobile/MobileNewTaskSheet";
import {
  isReviewableThread,
  MobileStatusDot,
  ProjectSyncBadge,
  RepoAvatar,
  useProjectSync,
} from "./mobile/mobileShared";

type MobileHomeTab = "sessions" | "projects" | "activity" | "settings";

// Remembered across MobileHome remounts (e.g. after visiting a settings
// sub-page and navigating back) so the user returns to the tab they left.
let lastMobileTab: MobileHomeTab = "sessions";

interface MobileProjectGroup {
  project: SidebarProjectSnapshot;
  threads: SidebarThreadSummary[];
}

export function MobileHome() {
  const [activeTab, setActiveTab] = useState<MobileHomeTab>(lastMobileTab);
  const [query, setQuery] = useState("");
  const changeTab = useCallback((tab: MobileHomeTab) => {
    lastMobileTab = tab;
    setActiveTab(tab);
  }, []);
  const [detailProjectKey, setDetailProjectKey] = useState<string | null>(null);
  const [newTask, setNewTask] = useState<{ open: boolean; seed: ScopedProjectRef | null }>({
    open: false,
    seed: null,
  });
  const navigate = useNavigate();
  const openCommandPalette = useCommandPaletteStore((store) => store.setOpen);
  const projectGroups = useMobileProjectGroups();
  const filteredProjectGroups = useMemo(
    () => filterProjectGroups(projectGroups, query),
    [projectGroups, query],
  );
  const visibleThreads = useMemo(
    () => filteredProjectGroups.flatMap((group) => group.threads),
    [filteredProjectGroups],
  );
  const activitySections = useMemo(() => buildActivitySections(visibleThreads), [visibleThreads]);

  const openThread = useCallback(
    (threadRef: ScopedThreadRef) => {
      void navigate({
        to: "/$environmentId/$threadId",
        params: {
          environmentId: threadRef.environmentId,
          threadId: threadRef.threadId,
        },
      });
    },
    [navigate],
  );
  const openNewTask = useCallback((seed?: ScopedProjectRef | null) => {
    setNewTask({ open: true, seed: seed ?? null });
  }, []);
  const closeNewTask = useCallback(() => setNewTask({ open: false, seed: null }), []);

  const detailGroup = useMemo(
    () =>
      detailProjectKey
        ? (projectGroups.find((group) => group.project.projectKey === detailProjectKey) ?? null)
        : null,
    [detailProjectKey, projectGroups],
  );

  const showSearchHeader = activeTab !== "settings";

  return (
    <SidebarInset className="flex h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground sm:hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        {showSearchHeader ? (
          <header className="shrink-0 border-b border-border/70 bg-background/92 px-3 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] backdrop-blur-xl">
            <div className="flex min-h-9 items-center gap-2">
              <SidebarTrigger className="size-9 shrink-0 rounded-lg border border-border/70 bg-card/70" />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-lg font-semibold">{APP_BASE_NAME}</span>
                  <span className="rounded-md border border-primary/35 bg-primary/12 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                    {APP_STAGE_LABEL}
                  </span>
                </div>
              </div>
              <Button
                aria-label="Search"
                className="size-9 rounded-lg border border-border/70 bg-card/70"
                size="icon"
                variant="ghost"
                onClick={() => openCommandPalette(true)}
              >
                <SearchIcon className="size-4" />
              </Button>
              <Button
                aria-label="New task"
                className="size-9 rounded-lg bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                size="icon"
                onClick={() => openNewTask()}
              >
                <PlusIcon className="size-4" />
              </Button>
            </div>

            <label className="mt-3 flex h-10 items-center gap-2 rounded-lg border border-border/70 bg-card/80 px-3 text-sm text-muted-foreground">
              <SearchIcon className="size-4 shrink-0" />
              <input
                className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground/70"
                placeholder="Search sessions, repos, branches..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </header>
        ) : null}

        <main className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          {activeTab === "sessions" ? (
            <SessionsTab
              groups={filteredProjectGroups}
              onNewTask={() => openNewTask()}
              onOpenThread={openThread}
            />
          ) : null}
          {activeTab === "projects" ? (
            <ProjectsTab
              groups={filteredProjectGroups}
              onNewTask={() => openNewTask()}
              onOpenProject={setDetailProjectKey}
            />
          ) : null}
          {activeTab === "activity" ? (
            <ActivityTab sections={activitySections} onOpenThread={openThread} />
          ) : null}
          {activeTab === "settings" ? <MobileSettings /> : null}
        </main>

        <MobileTabBar
          activeTab={activeTab}
          onTabChange={changeTab}
          reviewBadge={visibleThreads.some((thread) => isAttentionThread(thread))}
        />
      </div>

      {detailGroup ? (
        <MobileProjectDetail
          project={detailGroup.project}
          threads={detailGroup.threads}
          onBack={() => setDetailProjectKey(null)}
          onNewTask={() =>
            openNewTask(scopeProjectRef(detailGroup.project.environmentId, detailGroup.project.id))
          }
          onOpenThread={openThread}
        />
      ) : null}

      <MobileNewTaskSheet
        open={newTask.open}
        seedProjectRef={newTask.seed}
        onClose={closeNewTask}
      />
    </SidebarInset>
  );
}

function useMobileProjectGroups(): MobileProjectGroup[] {
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const sidebarThreads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const sidebarThreadSortOrder = useSettings((settings) => settings.sidebarThreadSortOrder);
  const sidebarProjectSortOrder = useSettings((settings) => settings.sidebarProjectSortOrder);
  const projectGroupingSettings = useSettings(selectProjectGroupingSettings);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const savedEnvironmentRegistry = useSavedEnvironmentRegistryStore((store) => store.byId);
  const savedEnvironmentRuntimeById = useSavedEnvironmentRuntimeStore((store) => store.byId);
  const orderedProjects = useMemo(
    () =>
      orderItemsByPreferredIds({
        items: projects,
        preferredIds: projectOrder,
        getId: getProjectOrderKey,
      }),
    [projectOrder, projects],
  );
  const sidebarProjects = useMemo(
    () =>
      buildSidebarProjectSnapshots({
        projects: orderedProjects,
        settings: projectGroupingSettings,
        primaryEnvironmentId,
        resolveEnvironmentLabel: (environmentId) => {
          const runtime = savedEnvironmentRuntimeById[environmentId];
          const saved = savedEnvironmentRegistry[environmentId];
          return runtime?.descriptor?.label ?? saved?.label ?? null;
        },
      }),
    [
      orderedProjects,
      primaryEnvironmentId,
      projectGroupingSettings,
      savedEnvironmentRegistry,
      savedEnvironmentRuntimeById,
    ],
  );
  const physicalToLogicalKey = useMemo(
    () =>
      buildPhysicalToLogicalProjectKeyMap({
        projects: orderedProjects,
        settings: projectGroupingSettings,
      }),
    [orderedProjects, projectGroupingSettings],
  );
  const projectPhysicalKeyByScopedRef = useMemo(
    () =>
      new Map(
        orderedProjects.map((project) => [
          scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
          derivePhysicalProjectKey(project),
        ]),
      ),
    [orderedProjects],
  );
  const visibleThreads = useMemo(
    () => sidebarThreads.filter((thread) => thread.archivedAt === null),
    [sidebarThreads],
  );
  const sortedProjects = useMemo(() => {
    const sidebarProjectByKey = new Map(
      sidebarProjects.map((project) => [project.projectKey, project] as const),
    );
    const sortableProjects = sidebarProjects.map((project) => ({
      ...project,
      id: project.projectKey,
    }));
    const sortableThreads = visibleThreads.map((thread) => {
      const physicalKey =
        projectPhysicalKeyByScopedRef.get(
          scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
        ) ?? scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId));
      return {
        ...thread,
        projectId: (physicalToLogicalKey.get(physicalKey) ?? physicalKey) as ProjectId,
      };
    });
    return sortProjectsForSidebar(
      sortableProjects,
      sortableThreads,
      sidebarProjectSortOrder,
    ).flatMap((project) => {
      const resolvedProject = sidebarProjectByKey.get(project.id);
      return resolvedProject ? [resolvedProject] : [];
    });
  }, [
    physicalToLogicalKey,
    projectPhysicalKeyByScopedRef,
    sidebarProjectSortOrder,
    sidebarProjects,
    visibleThreads,
  ]);
  const threadsByProjectKey = useMemo(() => {
    const result = new Map<string, SidebarThreadSummary[]>();
    for (const thread of visibleThreads) {
      const physicalKey =
        projectPhysicalKeyByScopedRef.get(
          scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
        ) ?? scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId));
      const projectKey = physicalToLogicalKey.get(physicalKey) ?? physicalKey;
      const existing = result.get(projectKey) ?? [];
      existing.push(thread);
      result.set(projectKey, existing);
    }
    return result;
  }, [physicalToLogicalKey, projectPhysicalKeyByScopedRef, visibleThreads]);

  return useMemo(
    () =>
      sortedProjects.map((project) => ({
        project,
        threads: sortThreads(
          threadsByProjectKey.get(project.projectKey) ?? [],
          sidebarThreadSortOrder,
        ),
      })),
    [sidebarThreadSortOrder, sortedProjects, threadsByProjectKey],
  );
}

function filterProjectGroups(groups: MobileProjectGroup[], query: string): MobileProjectGroup[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) {
    return groups;
  }

  return groups.flatMap((group) => {
    const projectMatches =
      group.project.displayName.toLocaleLowerCase().includes(needle) ||
      group.project.cwd.toLocaleLowerCase().includes(needle);
    const threads = projectMatches
      ? group.threads
      : group.threads.filter((thread) =>
          [thread.title, thread.branch ?? "", thread.worktreePath ?? ""]
            .join(" ")
            .toLocaleLowerCase()
            .includes(needle),
        );
    return threads.length > 0 ? [{ ...group, threads }] : [];
  });
}

function SessionsTab(props: {
  groups: MobileProjectGroup[];
  onNewTask: () => void;
  onOpenThread: (threadRef: ScopedThreadRef) => void;
}) {
  if (props.groups.length === 0) {
    return <MobileEmptyState onNewTask={props.onNewTask} />;
  }

  return (
    <div className="flex flex-col gap-5 pb-4">
      {props.groups.map((group) => (
        <section className="flex flex-col gap-2.5" key={group.project.projectKey}>
          <div className="flex items-center gap-2 px-0.5">
            <RepoAvatar name={group.project.displayName} size="sm" />
            <span className="min-w-0 truncate text-sm font-semibold">
              {group.project.displayName}
            </span>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70">
              · {group.threads.length} {group.threads.length === 1 ? "session" : "sessions"}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {group.threads.length > 0 ? (
              group.threads.map((thread) => (
                <MobileThreadCard
                  key={scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))}
                  thread={thread}
                  projectName={group.project.displayName}
                  projectCwd={group.project.cwd}
                  onOpenThread={props.onOpenThread}
                />
              ))
            ) : (
              <div className="rounded-xl border border-border/60 bg-card/35 px-3 py-4 text-center text-sm text-muted-foreground">
                No threads yet
              </div>
            )}
          </div>
        </section>
      ))}
      <Button className="h-11 rounded-xl" onClick={props.onNewTask}>
        <PlusIcon className="size-4" />
        Start new task
      </Button>
    </div>
  );
}

function ProjectsTab(props: {
  groups: MobileProjectGroup[];
  onNewTask: () => void;
  onOpenProject: (projectKey: string) => void;
}) {
  if (props.groups.length === 0) {
    return <MobileEmptyState onNewTask={props.onNewTask} />;
  }

  return (
    <div className="flex flex-col gap-3 pb-4">
      {props.groups.map((group) => (
        <MobileProjectCard
          key={group.project.projectKey}
          group={group}
          onOpen={() => props.onOpenProject(group.project.projectKey)}
        />
      ))}
    </div>
  );
}

function MobileProjectCard(props: { group: MobileProjectGroup; onOpen: () => void }) {
  const { group } = props;
  const sync = useProjectSync(group.project);
  const activeCount = group.threads.filter((thread) => isActiveThread(thread)).length;
  const headerBranch = group.threads[0]?.branch ?? group.project.cwd.split("/").pop() ?? "";

  return (
    <button
      type="button"
      className="rounded-xl border border-border/70 bg-card/65 p-3 text-left transition-transform active:scale-[0.99] active:bg-accent"
      onClick={props.onOpen}
    >
      <div className="flex items-center gap-3">
        <RepoAvatar name={group.project.displayName} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{group.project.displayName}</div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 truncate font-mono text-[11px] text-muted-foreground">
            <GitBranchIcon className="size-3 shrink-0" />
            <span className="truncate">{headerBranch}</span>
          </div>
        </div>
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ProjectSyncBadge sync={sync} />
        {activeCount > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-info/25 bg-info/12 px-2 py-0.5 text-[11px] font-semibold text-info">
            <span className="size-1.5 animate-pulse rounded-full bg-info" />
            {activeCount} active
          </span>
        ) : null}
        <span className="ml-auto font-mono text-[11px] text-muted-foreground/70">
          {group.threads.length} {group.threads.length === 1 ? "thread" : "threads"}
        </span>
      </div>
    </button>
  );
}

function ActivityTab(props: {
  sections: { id: string; label: string; threads: SidebarThreadSummary[] }[];
  onOpenThread: (threadRef: ScopedThreadRef) => void;
}) {
  if (props.sections.length === 0) {
    return (
      <div className="rounded-xl border border-border/60 bg-card/35 px-4 py-10 text-center">
        <CheckCircleIcon className="mx-auto size-8 text-success" />
        <div className="mt-3 text-sm font-medium">All clear</div>
        <div className="mt-1 text-xs text-muted-foreground">No active or recent threads.</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 pb-4">
      {props.sections.map((section) => (
        <section className="flex flex-col gap-2.5" key={section.id}>
          <div className="flex items-center justify-between px-0.5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {section.label}
            </h2>
            <span className="font-mono text-[11px] text-muted-foreground/70">
              {section.threads.length}
            </span>
          </div>
          <div className="overflow-hidden rounded-xl border border-border/70 bg-card/60">
            {section.threads.map((thread) => (
              <button
                className="flex min-h-14 w-full items-center gap-3 border-b border-border/50 px-3 py-2 text-left last:border-b-0 active:bg-accent"
                key={scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))}
                type="button"
                onClick={() => props.onOpenThread(scopeThreadRef(thread.environmentId, thread.id))}
              >
                <MobileStatusDot thread={thread} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{thread.title}</div>
                  <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                    {thread.branch ?? "no branch"} ·{" "}
                    {formatRelativeTimeLabel(
                      thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt,
                    )}
                  </div>
                </div>
                {isReviewableThread(thread) ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-violet-400/30 bg-violet-400/10 px-2 py-0.5 text-[11px] font-semibold text-violet-400">
                    <CheckCircleIcon className="size-3" />
                    review
                  </span>
                ) : (
                  <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                )}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function MobileEmptyState({ onNewTask }: { onNewTask: () => void }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/35 px-4 py-10 text-center">
      <SparklesIcon className="mx-auto size-8 text-primary" />
      <div className="mt-3 text-sm font-medium">No threads yet</div>
      <div className="mt-1 text-xs text-muted-foreground">Create a task to start.</div>
      <Button className="mt-5 h-10 rounded-xl" onClick={onNewTask}>
        <PlusIcon className="size-4" />
        Start new task
      </Button>
    </div>
  );
}

function MobileTabBar(props: {
  activeTab: MobileHomeTab;
  onTabChange: (tab: MobileHomeTab) => void;
  reviewBadge: boolean;
}) {
  return (
    <nav className="shrink-0 border-t border-border/70 bg-card/85 px-2 pb-[calc(env(safe-area-inset-bottom)+0.35rem)] pt-2 backdrop-blur-xl">
      <div className="grid grid-cols-4 gap-1">
        <TabButton
          active={props.activeTab === "sessions"}
          icon={<MessageSquareIcon className="size-4" />}
          label="Sessions"
          onClick={() => props.onTabChange("sessions")}
        />
        <TabButton
          active={props.activeTab === "projects"}
          icon={<FolderGit2Icon className="size-4" />}
          label="Projects"
          onClick={() => props.onTabChange("projects")}
        />
        <TabButton
          active={props.activeTab === "activity"}
          badge={props.reviewBadge}
          icon={<ActivityIcon className="size-4" />}
          label="Activity"
          onClick={() => props.onTabChange("activity")}
        />
        <TabButton
          active={props.activeTab === "settings"}
          icon={<SettingsIcon className="size-4" />}
          label="Settings"
          onClick={() => props.onTabChange("settings")}
        />
      </div>
    </nav>
  );
}

function TabButton(props: {
  active: boolean;
  badge?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`relative flex min-h-11 flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-medium ${
        props.active ? "bg-primary/12 text-primary" : "text-muted-foreground active:bg-accent"
      }`}
      type="button"
      onClick={props.onClick}
    >
      {props.badge ? (
        <span className="absolute right-[25%] top-1.5 size-1.5 rounded-full bg-violet-400" />
      ) : null}
      {props.icon}
      <span>{props.label}</span>
    </button>
  );
}

function buildActivitySections(threads: SidebarThreadSummary[]) {
  const attention = threads.filter((thread) => isAttentionThread(thread));
  const running = threads.filter((thread) => !isAttentionThread(thread) && isActiveThread(thread));
  const recent = threads.filter((thread) => !isAttentionThread(thread) && !isActiveThread(thread));

  return [
    { id: "attention", label: "Needs your attention", threads: attention },
    { id: "running", label: "Running now", threads: running },
    { id: "recent", label: "Recent work", threads: recent.slice(0, 12) },
  ].filter((section) => section.threads.length > 0);
}

function isAttentionThread(thread: SidebarThreadSummary) {
  return isReviewableThread(thread);
}

function isActiveThread(thread: SidebarThreadSummary) {
  return thread.session?.status === "running" || thread.session?.status === "connecting";
}
