import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime";
import type { ScopedProjectRef } from "@t3tools/contracts";
import { BoltIcon, CheckIcon, GitBranchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { useSettings } from "../../hooks/useSettings";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "../../logicalProject";
import { selectProjectsAcrossEnvironments, useStore } from "../../store";
import { resolveSidebarNewThreadEnvMode } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { Sheet, SheetPopup } from "../ui/sheet";
import { RepoAvatar } from "./mobileShared";

const TASK_SUGGESTIONS = [
  "Fix failing tests",
  "Review changed files",
  "Implement feature",
  "Refactor component",
];

export function MobileNewTaskSheet(props: {
  open: boolean;
  onClose: () => void;
  seedProjectRef?: ScopedProjectRef | null;
}) {
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const projectGroupingSettings = useSettings(selectProjectGroupingSettings);
  const defaultEnvMode = useSettings((settings) => settings.defaultThreadEnvMode);
  const { defaultProjectRef, handleNewThread } = useHandleNewThread();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [task, setTask] = useState("");
  const [newWorktree, setNewWorktree] = useState(
    resolveSidebarNewThreadEnvMode({ defaultEnvMode }) === "worktree",
  );
  const [starting, setStarting] = useState(false);

  const seedKey = props.seedProjectRef
    ? scopedProjectKey(props.seedProjectRef)
    : defaultProjectRef
      ? scopedProjectKey(defaultProjectRef)
      : null;

  // Reset the form each time the sheet opens, defaulting to the seeded project.
  useEffect(() => {
    if (props.open) {
      setSelectedKey(seedKey);
      setTask("");
      setNewWorktree(resolveSidebarNewThreadEnvMode({ defaultEnvMode }) === "worktree");
    }
  }, [props.open, seedKey, defaultEnvMode]);

  const selectedProject = useMemo(
    () =>
      projects.find(
        (project) =>
          scopedProjectKey(scopeProjectRef(project.environmentId, project.id)) === selectedKey,
      ) ?? null,
    [projects, selectedKey],
  );

  const canStart = selectedProject != null && !starting;

  const handleStart = async () => {
    if (!selectedProject) {
      return;
    }
    setStarting(true);
    const projectRef = scopeProjectRef(selectedProject.environmentId, selectedProject.id);
    const envMode = newWorktree ? "worktree" : "local";
    try {
      await handleNewThread(projectRef, { envMode });
      const trimmed = task.trim();
      if (trimmed.length > 0) {
        const logicalProjectKey = deriveLogicalProjectKeyFromSettings(
          selectedProject,
          projectGroupingSettings,
        );
        const draftStore = useComposerDraftStore.getState();
        const draft = draftStore.getDraftSessionByLogicalProjectKey(logicalProjectKey);
        if (draft) {
          draftStore.setPrompt(draft.draftId, trimmed);
        }
      }
      props.onClose();
    } finally {
      setStarting(false);
    }
  };

  return (
    <Sheet
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          props.onClose();
        }
      }}
    >
      <SheetPopup
        side="bottom"
        showCloseButton
        className="max-h-[88svh] rounded-t-3xl bg-popover p-0"
      >
        <div className="flex min-h-0 flex-col overflow-y-auto px-5 pt-2 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <div className="mx-auto mb-3 h-1 w-9 shrink-0 rounded-full bg-border" />
          <h2 className="text-lg font-bold tracking-tight">New task</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Pick a project and describe what the agent should do.
          </p>

          {/* Project selector */}
          <div className="mt-4 flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Project</span>
            {projects.length === 0 ? (
              <div className="rounded-xl border border-border/70 bg-card/60 px-3 py-4 text-center text-sm text-muted-foreground">
                No projects yet. Add one first.
              </div>
            ) : (
              <div className="flex max-h-44 flex-col gap-1.5 overflow-y-auto">
                {projects.map((project) => {
                  const key = scopedProjectKey(scopeProjectRef(project.environmentId, project.id));
                  const active = key === selectedKey;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                        active
                          ? "border-primary/45 bg-primary/12"
                          : "border-border/70 bg-card/60 active:bg-accent"
                      }`}
                      onClick={() => setSelectedKey(key)}
                    >
                      <RepoAvatar name={project.name} size="md" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{project.name}</span>
                        <span className="block truncate font-mono text-[11px] text-muted-foreground">
                          {project.cwd}
                        </span>
                      </span>
                      {active ? <CheckIcon className="size-4 shrink-0 text-primary" /> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Worktree toggle */}
          <button
            type="button"
            className="mt-4 flex items-center gap-3 rounded-xl border border-border/70 bg-card/60 px-3 py-3 text-left"
            onClick={() => setNewWorktree((value) => !value)}
          >
            <GitBranchIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">New worktree</span>
              <span className="block text-[11px] text-muted-foreground">
                {newWorktree
                  ? "Runs in an isolated branch worktree"
                  : "Runs in the project directory"}
              </span>
            </span>
            <span
              className={`relative h-6 w-10 shrink-0 rounded-full border transition-colors ${
                newWorktree ? "border-transparent bg-primary" : "border-border bg-card"
              }`}
            >
              <span
                className={`absolute top-0.5 size-4.5 rounded-full bg-white shadow-sm transition-all ${
                  newWorktree ? "left-[1.1rem]" : "left-0.5"
                }`}
              />
            </span>
          </button>

          {/* Task */}
          <div className="mt-4 flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Task</span>
            <textarea
              className="min-h-20 w-full resize-none rounded-xl border border-border/70 bg-card/60 px-3 py-2.5 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-primary/45"
              placeholder="Describe what the agent should do…"
              rows={3}
              value={task}
              onChange={(event) => setTask(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {TASK_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="rounded-full border border-border/70 bg-card/60 px-3 py-1.5 text-xs text-muted-foreground active:bg-accent"
                  onClick={() => setTask(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>

          <p className="mt-3 text-[11px] text-muted-foreground/80">
            Model, provider and access are chosen in the chat composer once the task starts.
          </p>

          <Button
            className="mt-4 h-11 rounded-xl"
            disabled={!canStart}
            onClick={() => void handleStart()}
          >
            <BoltIcon className="size-4" />
            Start agent
          </Button>
        </div>
      </SheetPopup>
    </Sheet>
  );
}
