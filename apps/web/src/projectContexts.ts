import {
  ProjectContextId,
  type ProjectContext,
  ProjectContextRuleId,
  type ProjectContextDefaults,
  type ProjectContextRule,
  type ProjectContextRuleKind,
  type ThreadEnvMode,
  type UnifiedSettings,
} from "@t3tools/contracts/settings";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime";
import type { SidebarThreadSummary, Project } from "./types";
import { derivePhysicalProjectKey } from "./logicalProject";

export interface ProjectContextSettings {
  projectContexts: readonly ProjectContext[];
  activeProjectContextId: ProjectContextId | null;
  projectContextAssignments: Record<string, ProjectContextId>;
  projectContextDefaults: Record<ProjectContextId, ProjectContextDefaults>;
  projectContextRules: readonly ProjectContextRule[];
}

export interface ProjectContextSummary {
  contextId: ProjectContextId | null;
  projectCount: number;
  threadCount: number;
}

export interface ProjectContextSettingsPatch {
  projectContexts: ProjectContext[];
  activeProjectContextId: ProjectContextId | null;
  projectContextAssignments: Record<string, ProjectContextId>;
  projectContextDefaults: Record<ProjectContextId, ProjectContextDefaults>;
  projectContextRules: ProjectContextRule[];
}

export function selectProjectContextSettings(settings: UnifiedSettings): ProjectContextSettings {
  return {
    projectContexts: settings.projectContexts,
    activeProjectContextId: settings.activeProjectContextId,
    projectContextAssignments: settings.projectContextAssignments,
    projectContextDefaults: settings.projectContextDefaults,
    projectContextRules: settings.projectContextRules,
  };
}

function validContextIds(settings: Pick<ProjectContextSettings, "projectContexts">): Set<string> {
  return new Set(settings.projectContexts.map((context) => context.id));
}

export function resolveActiveProjectContextId(
  settings: ProjectContextSettings,
): ProjectContextId | null {
  return settings.activeProjectContextId &&
    validContextIds(settings).has(settings.activeProjectContextId)
    ? settings.activeProjectContextId
    : null;
}

export function deriveProjectContextAssignmentKey(
  project: Pick<Project, "cwd" | "environmentId" | "repositoryIdentity">,
): string {
  const repositoryKey = project.repositoryIdentity?.canonicalKey?.trim();
  return repositoryKey ? `repo:${repositoryKey}` : `path:${derivePhysicalProjectKey(project)}`;
}

export function deriveProjectContextAssignmentKeys(
  project: Pick<Project, "cwd" | "environmentId" | "repositoryIdentity">,
): string[] {
  const pathKey = `path:${derivePhysicalProjectKey(project)}`;
  const repositoryKey = project.repositoryIdentity?.canonicalKey?.trim();
  return repositoryKey ? [`repo:${repositoryKey}`, pathKey] : [pathKey];
}

export function resolveProjectContextId(
  project: Pick<Project, "cwd" | "environmentId" | "repositoryIdentity">,
  settings: ProjectContextSettings,
): ProjectContextId | null {
  for (const assignmentKey of deriveProjectContextAssignmentKeys(project)) {
    const contextId = settings.projectContextAssignments[assignmentKey] ?? null;
    if (contextId && validContextIds(settings).has(contextId)) {
      return contextId;
    }
  }
  return null;
}

export function filterProjectsByActiveProjectContext(
  projects: readonly Project[],
  settings: ProjectContextSettings,
): Project[] {
  const activeContextId = resolveActiveProjectContextId(settings);
  if (!activeContextId) {
    return [...projects];
  }

  return projects.filter(
    (project) => resolveProjectContextId(project, settings) === activeContextId,
  );
}

export function createProjectContext(input: {
  name: string;
  existingContexts: readonly Pick<ProjectContext, "id" | "sortOrder">[];
}): ProjectContext {
  const trimmedName = input.name.trim() || "Context";
  const baseId =
    trimmedName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "context";
  const existingIds = new Set<string>(input.existingContexts.map((context) => context.id));
  let candidate = baseId;
  for (let suffix = 2; existingIds.has(candidate); suffix += 1) {
    candidate = `${baseId}-${suffix}`;
  }

  return {
    id: ProjectContextId.make(candidate),
    name: trimmedName,
    sortOrder: Math.max(-1, ...input.existingContexts.map((context) => context.sortOrder ?? 0)) + 1,
  };
}

export function createProjectContextRule(input: {
  contextId: ProjectContextId;
  kind: ProjectContextRuleKind;
  pattern: string;
  existingRules: readonly Pick<ProjectContextRule, "id" | "sortOrder">[];
}): ProjectContextRule {
  const trimmedPattern = input.pattern.trim();
  const baseId =
    `${input.kind}-${trimmedPattern}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "rule";
  const existingIds = new Set<string>(input.existingRules.map((rule) => rule.id));
  let candidate = baseId;
  for (let suffix = 2; existingIds.has(candidate); suffix += 1) {
    candidate = `${baseId}-${suffix}`;
  }

  return {
    id: ProjectContextRuleId.make(candidate),
    contextId: input.contextId,
    kind: input.kind,
    pattern: trimmedPattern,
    sortOrder: Math.max(-1, ...input.existingRules.map((rule) => rule.sortOrder ?? 0)) + 1,
  };
}

export function assignProjectToContext(input: {
  project: Pick<Project, "cwd" | "environmentId" | "repositoryIdentity">;
  contextId: ProjectContextId | null;
  assignments: Record<string, ProjectContextId>;
}): Record<string, ProjectContextId> {
  const nextAssignments = { ...input.assignments };
  for (const assignmentKey of deriveProjectContextAssignmentKeys(input.project)) {
    if (input.contextId) {
      nextAssignments[assignmentKey] = input.contextId;
    } else {
      delete nextAssignments[assignmentKey];
    }
  }
  return nextAssignments;
}

export function sortProjectContexts(contexts: readonly ProjectContext[]): ProjectContext[] {
  return contexts
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
}

export function sortProjectContextRules(
  rules: readonly ProjectContextRule[],
): ProjectContextRule[] {
  return rules
    .slice()
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.pattern.localeCompare(right.pattern),
    );
}

export function resolveProjectContextDefaults(
  settings: ProjectContextSettings,
  contextId: ProjectContextId | null,
): ProjectContextDefaults {
  if (!contextId || !validContextIds(settings).has(contextId)) {
    return {};
  }
  return settings.projectContextDefaults[contextId] ?? {};
}

export function resolveProjectContextDefaultThreadEnvMode(
  settings: ProjectContextSettings,
  contextId: ProjectContextId | null,
  fallback: ThreadEnvMode,
): ThreadEnvMode {
  return resolveProjectContextDefaults(settings, contextId).defaultThreadEnvMode ?? fallback;
}

export function resolveProjectContextAddProjectBaseDirectory(
  settings: ProjectContextSettings,
  contextId: ProjectContextId | null,
  fallback: string,
): string {
  const value = resolveProjectContextDefaults(settings, contextId).addProjectBaseDirectory?.trim();
  return value && value.length > 0 ? value : fallback;
}

function normalizeRuleMatchText(value: string): string {
  return value.trim().toLowerCase();
}

export function doesProjectMatchContextRule(
  project: Pick<Project, "cwd" | "repositoryIdentity">,
  rule: Pick<ProjectContextRule, "kind" | "pattern">,
): boolean {
  const pattern = normalizeRuleMatchText(rule.pattern);
  if (!pattern) {
    return false;
  }

  switch (rule.kind) {
    case "path_prefix":
      return normalizeRuleMatchText(project.cwd).startsWith(pattern);
    case "repository_prefix": {
      const repositoryKey = project.repositoryIdentity?.canonicalKey?.trim();
      return repositoryKey ? normalizeRuleMatchText(repositoryKey).startsWith(pattern) : false;
    }
    case "remote_url_contains": {
      const remoteUrl = project.repositoryIdentity?.locator.remoteUrl?.trim();
      return remoteUrl ? normalizeRuleMatchText(remoteUrl).includes(pattern) : false;
    }
  }
}

export function resolveProjectContextRuleMatch(
  project: Pick<Project, "cwd" | "repositoryIdentity">,
  settings: ProjectContextSettings,
): ProjectContextRule | null {
  const contextIds = validContextIds(settings);
  return (
    sortProjectContextRules(settings.projectContextRules).find(
      (rule) => contextIds.has(rule.contextId) && doesProjectMatchContextRule(project, rule),
    ) ?? null
  );
}

export function applyProjectContextRules(input: {
  projects: readonly Project[];
  settings: ProjectContextSettings;
  overwriteExisting: boolean;
}): Record<string, ProjectContextId> {
  let assignments = { ...input.settings.projectContextAssignments };
  for (const project of input.projects) {
    if (!input.overwriteExisting && resolveProjectContextId(project, input.settings)) {
      continue;
    }
    const rule = resolveProjectContextRuleMatch(project, {
      ...input.settings,
      projectContextAssignments: assignments,
    });
    if (!rule) {
      continue;
    }
    assignments = assignProjectToContext({
      project,
      contextId: rule.contextId,
      assignments,
    });
  }
  return assignments;
}

export function renameProjectContext(input: {
  contexts: readonly ProjectContext[];
  contextId: ProjectContextId;
  name: string;
}): ProjectContext[] {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    return [...input.contexts];
  }
  return input.contexts.map((context) =>
    context.id === input.contextId ? { ...context, name: trimmedName } : context,
  );
}

export function reorderProjectContext(input: {
  contexts: readonly ProjectContext[];
  contextId: ProjectContextId;
  direction: "up" | "down";
}): ProjectContext[] {
  const sortedContexts = sortProjectContexts(input.contexts);
  const currentIndex = sortedContexts.findIndex((context) => context.id === input.contextId);
  if (currentIndex === -1) {
    return [...input.contexts];
  }
  const targetIndex = input.direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= sortedContexts.length) {
    return sortedContexts;
  }

  const reordered = [...sortedContexts];
  const [context] = reordered.splice(currentIndex, 1);
  reordered.splice(targetIndex, 0, context!);
  return reordered.map((context, index) => ({ ...context, sortOrder: index }));
}

export function reorderProjectContextRule(input: {
  rules: readonly ProjectContextRule[];
  ruleId: ProjectContextRuleId;
  direction: "up" | "down";
}): ProjectContextRule[] {
  const sortedRules = sortProjectContextRules(input.rules);
  const currentIndex = sortedRules.findIndex((rule) => rule.id === input.ruleId);
  if (currentIndex === -1) {
    return [...input.rules];
  }
  const targetIndex = input.direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= sortedRules.length) {
    return sortedRules;
  }

  const reordered = [...sortedRules];
  const [rule] = reordered.splice(currentIndex, 1);
  reordered.splice(targetIndex, 0, rule!);
  return reordered.map((rule, index) => ({ ...rule, sortOrder: index }));
}

export function removeProjectContextRule(input: {
  rules: readonly ProjectContextRule[];
  ruleId: ProjectContextRuleId;
}): ProjectContextRule[] {
  return sortProjectContextRules(input.rules)
    .filter((rule) => rule.id !== input.ruleId)
    .map((rule, index) => ({ ...rule, sortOrder: index }));
}

export function removeProjectContext(input: {
  settings: ProjectContextSettings;
  contextId: ProjectContextId;
  replacementContextId: ProjectContextId | null;
}): ProjectContextSettingsPatch {
  const remainingContexts = sortProjectContexts(input.settings.projectContexts)
    .filter((context) => context.id !== input.contextId)
    .map((context, index) => ({ ...context, sortOrder: index }));
  const remainingContextIds = new Set(remainingContexts.map((context) => context.id));
  const replacementContextId =
    input.replacementContextId && remainingContextIds.has(input.replacementContextId)
      ? input.replacementContextId
      : null;
  const projectContextAssignments: Record<string, ProjectContextId> = {};
  const projectContextDefaults: Record<ProjectContextId, ProjectContextDefaults> = {};

  for (const [assignmentKey, contextId] of Object.entries(
    input.settings.projectContextAssignments,
  )) {
    if (contextId === input.contextId) {
      if (replacementContextId) {
        projectContextAssignments[assignmentKey] = replacementContextId;
      }
      continue;
    }
    if (remainingContextIds.has(contextId)) {
      projectContextAssignments[assignmentKey] = contextId;
    }
  }

  for (const [contextId, defaults] of Object.entries(input.settings.projectContextDefaults)) {
    const typedContextId = ProjectContextId.make(contextId);
    if (remainingContextIds.has(typedContextId)) {
      projectContextDefaults[typedContextId] = defaults;
    }
  }

  return {
    projectContexts: remainingContexts,
    activeProjectContextId:
      input.settings.activeProjectContextId === input.contextId
        ? replacementContextId
        : resolveActiveProjectContextId({
            ...input.settings,
            projectContexts: remainingContexts,
          }),
    projectContextAssignments,
    projectContextDefaults,
    projectContextRules: sortProjectContextRules(input.settings.projectContextRules).filter(
      (rule) => remainingContextIds.has(rule.contextId),
    ),
  };
}

export function buildProjectContextSummaries(input: {
  projects: readonly Project[];
  threads: readonly SidebarThreadSummary[];
  settings: ProjectContextSettings;
}): ProjectContextSummary[] {
  const summaries = new Map<string | null, ProjectContextSummary>();
  const ensureSummary = (contextId: ProjectContextId | null): ProjectContextSummary => {
    const key = contextId ?? null;
    const existing = summaries.get(key);
    if (existing) {
      return existing;
    }
    const summary = {
      contextId,
      projectCount: 0,
      threadCount: 0,
    };
    summaries.set(key, summary);
    return summary;
  };

  ensureSummary(null);
  for (const context of input.settings.projectContexts) {
    ensureSummary(context.id);
  }

  const contextIdByProjectRef = new Map<string, ProjectContextId | null>();
  for (const project of input.projects) {
    const contextId = resolveProjectContextId(project, input.settings);
    ensureSummary(null).projectCount += 1;
    if (contextId) {
      ensureSummary(contextId).projectCount += 1;
    }
    contextIdByProjectRef.set(
      scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
      contextId,
    );
  }

  for (const thread of input.threads) {
    if (thread.archivedAt !== null) {
      continue;
    }
    const projectKey = scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId));
    const contextId = contextIdByProjectRef.get(projectKey) ?? null;
    ensureSummary(null).threadCount += 1;
    if (contextId) {
      ensureSummary(contextId).threadCount += 1;
    }
  }

  return [
    ensureSummary(null),
    ...sortProjectContexts(input.settings.projectContexts).map((context) =>
      ensureSummary(context.id),
    ),
  ];
}
