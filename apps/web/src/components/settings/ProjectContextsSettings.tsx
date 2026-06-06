import {
  ArrowDownIcon,
  ArrowUpIcon,
  BriefcaseBusinessIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { ProjectContextId } from "@t3tools/contracts/settings";
import { useShallow } from "zustand/react/shallow";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { ensureLocalApi, readLocalApi } from "../../localApi";
import {
  buildProjectContextSummaries,
  createProjectContext,
  removeProjectContext,
  renameProjectContext,
  reorderProjectContext,
  resolveActiveProjectContextId,
  selectProjectContextSettings,
  sortProjectContexts,
} from "../../projectContexts";
import {
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsAcrossEnvironments,
  useStore,
} from "../../store";
import { Button } from "../ui/button";
import { DraftInput } from "../ui/draft-input";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

const NO_CONTEXT_VALUE = "none";
const ALL_CONTEXTS_VALUE = "all";

function contextSelectValue(contextId: ProjectContextId | null): string {
  return contextId ?? NO_CONTEXT_VALUE;
}

function contextIdFromSelectValue(value: string): ProjectContextId | null {
  return value === NO_CONTEXT_VALUE || value === ALL_CONTEXTS_VALUE
    ? null
    : ProjectContextId.make(value);
}

function formatCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function ProjectContextsSettingsPanel() {
  const settings = useSettings();
  const projectContextSettings = selectProjectContextSettings(settings);
  const activeContextId = resolveActiveProjectContextId(projectContextSettings);
  const { updateSettings } = useUpdateSettings();
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const threads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  const [newContextName, setNewContextName] = useState("");
  const [replacementByContextId, setReplacementByContextId] = useState<
    Record<string, ProjectContextId | null>
  >({});

  const sortedContexts = useMemo(
    () => sortProjectContexts(projectContextSettings.projectContexts),
    [projectContextSettings.projectContexts],
  );
  const summaries = useMemo(
    () =>
      buildProjectContextSummaries({
        projects,
        threads,
        settings: projectContextSettings,
      }),
    [projectContextSettings, projects, threads],
  );
  const summaryByContextId = useMemo(
    () => new Map(summaries.map((summary) => [summary.contextId ?? null, summary] as const)),
    [summaries],
  );

  const createContext = useCallback(() => {
    const trimmedName = newContextName.trim();
    if (!trimmedName) {
      return;
    }
    const nextContext = createProjectContext({
      name: trimmedName,
      existingContexts: projectContextSettings.projectContexts,
    });
    updateSettings({
      projectContexts: [...projectContextSettings.projectContexts, nextContext],
      activeProjectContextId: nextContext.id,
    });
    setNewContextName("");
  }, [newContextName, projectContextSettings.projectContexts, updateSettings]);

  const renameContext = useCallback(
    (contextId: ProjectContextId, name: string) => {
      updateSettings({
        projectContexts: renameProjectContext({
          contexts: projectContextSettings.projectContexts,
          contextId,
          name,
        }),
      });
    },
    [projectContextSettings.projectContexts, updateSettings],
  );

  const reorderContext = useCallback(
    (contextId: ProjectContextId, direction: "up" | "down") => {
      updateSettings({
        projectContexts: reorderProjectContext({
          contexts: projectContextSettings.projectContexts,
          contextId,
          direction,
        }),
      });
    },
    [projectContextSettings.projectContexts, updateSettings],
  );

  const deleteContext = useCallback(
    async (contextId: ProjectContextId) => {
      const context = sortedContexts.find((item) => item.id === contextId);
      if (!context) {
        return;
      }
      const summary = summaryByContextId.get(contextId);
      const replacementContextId = replacementByContextId[contextId] ?? null;
      const replacementContext = replacementContextId
        ? sortedContexts.find((item) => item.id === replacementContextId)
        : null;
      const projectCount = summary?.projectCount ?? 0;
      const destination = replacementContext?.name ?? "No context";
      const confirmed = await (readLocalApi() ?? ensureLocalApi()).dialogs.confirm(
        [
          `Remove workspace "${context.name}"?`,
          projectCount > 0
            ? `${formatCount(projectCount, "project", "projects")} will move to ${destination}.`
            : "No projects are assigned to this workspace.",
        ].join("\n"),
      );
      if (!confirmed) {
        return;
      }

      updateSettings(
        removeProjectContext({
          settings: projectContextSettings,
          contextId,
          replacementContextId,
        }),
      );
      toastManager.add(
        stackedThreadToast({
          type: "success",
          title: `Removed "${context.name}"`,
          description:
            projectCount > 0
              ? `Moved ${formatCount(projectCount, "project", "projects")} to ${destination}.`
              : undefined,
        }),
      );
    },
    [
      projectContextSettings,
      replacementByContextId,
      sortedContexts,
      summaryByContextId,
      updateSettings,
    ],
  );

  return (
    <SettingsPageContainer>
      <SettingsSection title="Workspaces" icon={<BriefcaseBusinessIcon className="size-3.5" />}>
        <SettingsRow
          title="Active workspace"
          description="This controls which projects and threads are shown by default."
          control={
            <Select
              value={activeContextId ?? ALL_CONTEXTS_VALUE}
              onValueChange={(value) =>
                value === null
                  ? undefined
                  : updateSettings({
                      activeProjectContextId:
                        value === ALL_CONTEXTS_VALUE ? null : ProjectContextId.make(value),
                    })
              }
            >
              <SelectTrigger className="w-full sm:w-48" aria-label="Active workspace">
                <SelectValue>
                  {activeContextId
                    ? (sortedContexts.find((context) => context.id === activeContextId)?.name ??
                      "All contexts")
                    : "All contexts"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value={ALL_CONTEXTS_VALUE}>
                  All contexts
                </SelectItem>
                {sortedContexts.map((context) => (
                  <SelectItem hideIndicator key={context.id} value={context.id}>
                    {context.name}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title="New workspace"
          description="Create a workspace for a company, client, group, or area of work."
          control={
            <div className="flex w-full items-center gap-2 sm:w-72">
              <Input
                value={newContextName}
                placeholder="Startup"
                aria-label="New workspace name"
                onChange={(event) => setNewContextName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    createContext();
                  }
                }}
              />
              <Button
                size="sm"
                disabled={newContextName.trim().length === 0}
                onClick={createContext}
              >
                <PlusIcon className="size-4" />
                Create
              </Button>
            </div>
          }
        />

        {sortedContexts.length === 0 ? (
          <SettingsRow
            title="No workspaces"
            description="Create a workspace to separate projects from different companies or groups."
          />
        ) : null}

        {sortedContexts.map((context, index) => {
          const summary = summaryByContextId.get(context.id);
          const projectCount = summary?.projectCount ?? 0;
          const threadCount = summary?.threadCount ?? 0;
          const replacementContextId = replacementByContextId[context.id] ?? null;
          const replacementOptions = sortedContexts.filter((item) => item.id !== context.id);

          return (
            <SettingsRow
              key={context.id}
              title={
                <DraftInput
                  className="h-7 w-full max-w-56 px-0 text-[13px] font-semibold"
                  value={context.name}
                  onCommit={(name) => renameContext(context.id, name)}
                  aria-label={`Rename ${context.name}`}
                />
              }
              description={`${formatCount(projectCount, "project", "projects")} · ${formatCount(
                threadCount,
                "thread",
                "threads",
              )}`}
              control={
                <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
                  <Button
                    size="icon-sm"
                    variant="outline"
                    aria-label={`Move ${context.name} up`}
                    disabled={index === 0}
                    onClick={() => reorderContext(context.id, "up")}
                  >
                    <ArrowUpIcon className="size-4" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="outline"
                    aria-label={`Move ${context.name} down`}
                    disabled={index === sortedContexts.length - 1}
                    onClick={() => reorderContext(context.id, "down")}
                  >
                    <ArrowDownIcon className="size-4" />
                  </Button>
                  <Select
                    value={contextSelectValue(replacementContextId)}
                    onValueChange={(value) =>
                      value === null
                        ? undefined
                        : setReplacementByContextId((previous) => ({
                            ...previous,
                            [context.id]: contextIdFromSelectValue(value),
                          }))
                    }
                  >
                    <SelectTrigger
                      className="w-full sm:w-40"
                      aria-label={`Move projects from ${context.name} to`}
                    >
                      <SelectValue>
                        {replacementContextId
                          ? (sortedContexts.find((item) => item.id === replacementContextId)
                              ?.name ?? "No context")
                          : "No context"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      <SelectItem hideIndicator value={NO_CONTEXT_VALUE}>
                        No context
                      </SelectItem>
                      {replacementOptions.map((option) => (
                        <SelectItem hideIndicator key={option.id} value={option.id}>
                          {option.name}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                  <Button
                    size="icon-sm"
                    variant="destructive"
                    aria-label={`Remove ${context.name}`}
                    onClick={() => void deleteContext(context.id)}
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </div>
              }
            />
          );
        })}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
