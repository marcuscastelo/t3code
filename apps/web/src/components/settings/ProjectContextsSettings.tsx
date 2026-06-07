import {
  ArrowDownIcon,
  ArrowUpIcon,
  BriefcaseBusinessIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
  ProjectContextId,
  type ProjectContextDefaults,
  type ProjectContextRuleKind,
  type ThreadEnvMode,
} from "@t3tools/contracts/settings";
import { useShallow } from "zustand/react/shallow";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { ensureLocalApi, readLocalApi } from "../../localApi";
import {
  applyProjectContextRules,
  buildProjectContextSummaries,
  createProjectContext,
  createProjectContextRule,
  removeProjectContext,
  removeProjectContextRule,
  renameProjectContext,
  reorderProjectContext,
  reorderProjectContextRule,
  resolveActiveProjectContextId,
  selectProjectContextSettings,
  sortProjectContextRules,
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
const RULE_KIND_OPTIONS: ReadonlyArray<{ value: ProjectContextRuleKind; label: string }> = [
  { value: "path_prefix", label: "Path starts with" },
  { value: "repository_prefix", label: "Repository starts with" },
  { value: "remote_url_contains", label: "Remote URL contains" },
];
const THREAD_ENV_MODE_OPTIONS: ReadonlyArray<{ value: ThreadEnvMode; label: string }> = [
  { value: "local", label: "Local" },
  { value: "worktree", label: "New worktree" },
];

type ProjectContextDefaultsPatch = {
  defaultThreadEnvMode?: ThreadEnvMode | undefined;
  addProjectBaseDirectory?: string | undefined;
};

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
  const [newRuleContextId, setNewRuleContextId] = useState<ProjectContextId | null>(
    activeContextId,
  );
  const [newRuleKind, setNewRuleKind] = useState<ProjectContextRuleKind>("path_prefix");
  const [newRulePattern, setNewRulePattern] = useState("");

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
  const sortedRules = useMemo(
    () => sortProjectContextRules(projectContextSettings.projectContextRules),
    [projectContextSettings.projectContextRules],
  );
  const contextNameById = useMemo(
    () => new Map(sortedContexts.map((context) => [context.id, context.name] as const)),
    [sortedContexts],
  );
  const selectedNewRuleContextId =
    newRuleContextId ?? activeContextId ?? sortedContexts[0]?.id ?? null;

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
    setNewRuleContextId(nextContext.id);
    setNewContextName("");
  }, [newContextName, projectContextSettings.projectContexts, updateSettings]);

  const updateContextDefaults = useCallback(
    (contextId: ProjectContextId, patch: ProjectContextDefaultsPatch) => {
      const currentDefaults = projectContextSettings.projectContextDefaults[contextId] ?? {};
      const nextDefaults = { ...currentDefaults, ...patch };
      if (nextDefaults.addProjectBaseDirectory !== undefined) {
        const trimmed = nextDefaults.addProjectBaseDirectory.trim();
        if (trimmed) {
          nextDefaults.addProjectBaseDirectory = trimmed;
        } else {
          delete nextDefaults.addProjectBaseDirectory;
        }
      }
      if (nextDefaults.defaultThreadEnvMode === undefined) {
        delete nextDefaults.defaultThreadEnvMode;
      }

      const projectContextDefaults = { ...projectContextSettings.projectContextDefaults };
      const persistedDefaults: ProjectContextDefaults = {
        ...(nextDefaults.defaultThreadEnvMode !== undefined
          ? { defaultThreadEnvMode: nextDefaults.defaultThreadEnvMode }
          : {}),
        ...(nextDefaults.addProjectBaseDirectory !== undefined
          ? { addProjectBaseDirectory: nextDefaults.addProjectBaseDirectory }
          : {}),
      };

      if (Object.keys(persistedDefaults).length === 0) {
        delete projectContextDefaults[contextId];
      } else {
        projectContextDefaults[contextId] = persistedDefaults;
      }
      updateSettings({ projectContextDefaults });
    },
    [projectContextSettings.projectContextDefaults, updateSettings],
  );

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

  const createRule = useCallback(() => {
    const trimmedPattern = newRulePattern.trim();
    if (!selectedNewRuleContextId || !trimmedPattern) {
      return;
    }
    updateSettings({
      projectContextRules: [
        ...projectContextSettings.projectContextRules,
        createProjectContextRule({
          contextId: selectedNewRuleContextId,
          kind: newRuleKind,
          pattern: trimmedPattern,
          existingRules: projectContextSettings.projectContextRules,
        }),
      ],
    });
    setNewRulePattern("");
  }, [
    newRuleKind,
    newRulePattern,
    projectContextSettings.projectContextRules,
    selectedNewRuleContextId,
    updateSettings,
  ]);

  const applyRules = useCallback(
    async (overwriteExisting: boolean) => {
      const confirmed = overwriteExisting
        ? await (readLocalApi() ?? ensureLocalApi()).dialogs.confirm(
            "Re-apply workspace rules to all projects?\nExisting workspace assignments may change.",
          )
        : true;
      if (!confirmed) {
        return;
      }
      const projectContextAssignments = applyProjectContextRules({
        projects,
        settings: projectContextSettings,
        overwriteExisting,
      });
      updateSettings({ projectContextAssignments });
      toastManager.add(
        stackedThreadToast({
          type: "success",
          title: overwriteExisting ? "Rules re-applied" : "Rules applied",
          description: overwriteExisting
            ? "Existing project assignments were updated where rules matched."
            : "Unassigned projects were moved where rules matched.",
        }),
      );
    },
    [projectContextSettings, projects, updateSettings],
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
          const defaults = projectContextSettings.projectContextDefaults[context.id] ?? {};

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
            >
              <div className="mt-3 grid gap-3 border-t border-border/50 py-3 sm:grid-cols-2">
                <label className="flex min-w-0 flex-col gap-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    Default new thread mode
                  </span>
                  <Select
                    value={defaults.defaultThreadEnvMode ?? "inherit"}
                    onValueChange={(value) => {
                      if (value === null) return;
                      updateContextDefaults(
                        context.id,
                        value === "inherit"
                          ? { defaultThreadEnvMode: undefined }
                          : { defaultThreadEnvMode: value as ThreadEnvMode },
                      );
                    }}
                  >
                    <SelectTrigger className="w-full" aria-label={`${context.name} thread mode`}>
                      <SelectValue>
                        {defaults.defaultThreadEnvMode
                          ? THREAD_ENV_MODE_OPTIONS.find(
                              (option) => option.value === defaults.defaultThreadEnvMode,
                            )?.label
                          : "Use global default"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup alignItemWithTrigger={false}>
                      <SelectItem hideIndicator value="inherit">
                        Use global default
                      </SelectItem>
                      {THREAD_ENV_MODE_OPTIONS.map((option) => (
                        <SelectItem hideIndicator key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </label>

                <label className="flex min-w-0 flex-col gap-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    Add project starts in
                  </span>
                  <DraftInput
                    value={defaults.addProjectBaseDirectory ?? ""}
                    placeholder="Use global default"
                    spellCheck={false}
                    aria-label={`${context.name} add project base directory`}
                    onCommit={(value) =>
                      updateContextDefaults(context.id, {
                        addProjectBaseDirectory: value,
                      })
                    }
                  />
                </label>
              </div>
            </SettingsRow>
          );
        })}
      </SettingsSection>

      <SettingsSection
        title="Workspace rules"
        icon={<BriefcaseBusinessIcon className="size-3.5" />}
        headerAction={
          <div className="flex items-center gap-1">
            <Button
              size="xs"
              variant="outline"
              disabled={sortedRules.length === 0}
              onClick={() => void applyRules(false)}
            >
              Apply
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={sortedRules.length === 0}
              onClick={() => void applyRules(true)}
            >
              Re-apply all
            </Button>
          </div>
        }
      >
        <SettingsRow
          title="New rule"
          description="Rules assign projects to workspaces by path, repository, or remote URL."
          control={
            <div className="grid w-full gap-2 sm:w-[34rem] sm:grid-cols-[1fr_1fr_1.4fr_auto]">
              <Select
                value={selectedNewRuleContextId ?? ""}
                onValueChange={(value) =>
                  value === null ? undefined : setNewRuleContextId(ProjectContextId.make(value))
                }
              >
                <SelectTrigger className="w-full" aria-label="Rule workspace">
                  <SelectValue>
                    {selectedNewRuleContextId
                      ? (contextNameById.get(selectedNewRuleContextId) ?? "Workspace")
                      : "Workspace"}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  {sortedContexts.map((context) => (
                    <SelectItem hideIndicator key={context.id} value={context.id}>
                      {context.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <Select
                value={newRuleKind}
                onValueChange={(value) =>
                  value === null ? undefined : setNewRuleKind(value as ProjectContextRuleKind)
                }
              >
                <SelectTrigger className="w-full" aria-label="Rule kind">
                  <SelectValue>
                    {RULE_KIND_OPTIONS.find((option) => option.value === newRuleKind)?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  {RULE_KIND_OPTIONS.map((option) => (
                    <SelectItem hideIndicator key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <Input
                value={newRulePattern}
                placeholder={
                  newRuleKind === "path_prefix"
                    ? "~/work/company"
                    : newRuleKind === "repository_prefix"
                      ? "github.com/company/"
                      : "github.com:company"
                }
                aria-label="Rule pattern"
                onChange={(event) => setNewRulePattern(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    createRule();
                  }
                }}
              />
              <Button
                size="sm"
                disabled={!selectedNewRuleContextId || newRulePattern.trim().length === 0}
                onClick={createRule}
              >
                <PlusIcon className="size-4" />
                Add
              </Button>
            </div>
          }
        />

        {sortedRules.length === 0 ? (
          <SettingsRow
            title="No rules"
            description="Add a rule to classify existing and future projects by path or repository."
          />
        ) : null}

        {sortedRules.map((rule, index) => (
          <SettingsRow
            key={rule.id}
            title={contextNameById.get(rule.contextId) ?? "Unknown workspace"}
            description={`${
              RULE_KIND_OPTIONS.find((option) => option.value === rule.kind)?.label ?? rule.kind
            }: ${rule.pattern}`}
            control={
              <div className="flex items-center gap-2">
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label="Move rule up"
                  disabled={index === 0}
                  onClick={() =>
                    updateSettings({
                      projectContextRules: reorderProjectContextRule({
                        rules: projectContextSettings.projectContextRules,
                        ruleId: rule.id,
                        direction: "up",
                      }),
                    })
                  }
                >
                  <ArrowUpIcon className="size-4" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label="Move rule down"
                  disabled={index === sortedRules.length - 1}
                  onClick={() =>
                    updateSettings({
                      projectContextRules: reorderProjectContextRule({
                        rules: projectContextSettings.projectContextRules,
                        ruleId: rule.id,
                        direction: "down",
                      }),
                    })
                  }
                >
                  <ArrowDownIcon className="size-4" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="destructive"
                  aria-label="Remove rule"
                  onClick={() =>
                    updateSettings({
                      projectContextRules: removeProjectContextRule({
                        rules: projectContextSettings.projectContextRules,
                        ruleId: rule.id,
                      }),
                    })
                  }
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </div>
            }
          />
        ))}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
