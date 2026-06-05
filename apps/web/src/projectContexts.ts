import {
  ProjectContextId,
  type ProjectContext,
  type UnifiedSettings,
} from "@t3tools/contracts/settings";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime";
import type { SidebarThreadSummary, Project } from "./types";
import { derivePhysicalProjectKey } from "./logicalProject";

export interface ProjectContextSettings {
  projectContexts: readonly ProjectContext[];
  activeProjectContextId: ProjectContextId | null;
  projectContextAssignments: Record<string, ProjectContextId>;
}

export interface ProjectContextSummary {
  contextId: ProjectContextId | null;
  projectCount: number;
  threadCount: number;
}

export function selectProjectContextSettings(settings: UnifiedSettings): ProjectContextSettings {
  return {
    projectContexts: settings.projectContexts,
    activeProjectContextId: settings.activeProjectContextId,
    projectContextAssignments: settings.projectContextAssignments,
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

export function resolveProjectContextId(
  project: Pick<Project, "cwd" | "environmentId" | "repositoryIdentity">,
  settings: ProjectContextSettings,
): ProjectContextId | null {
  const contextId =
    settings.projectContextAssignments[deriveProjectContextAssignmentKey(project)] ?? null;
  return contextId && validContextIds(settings).has(contextId) ? contextId : null;
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

export function assignProjectToContext(input: {
  project: Pick<Project, "cwd" | "environmentId" | "repositoryIdentity">;
  contextId: ProjectContextId | null;
  assignments: Record<string, ProjectContextId>;
}): Record<string, ProjectContextId> {
  const assignmentKey = deriveProjectContextAssignmentKey(input.project);
  const nextAssignments = { ...input.assignments };
  if (input.contextId) {
    nextAssignments[assignmentKey] = input.contextId;
  } else {
    delete nextAssignments[assignmentKey];
  }
  return nextAssignments;
}

export function buildProjectContextSummaries(input: {
  projects: readonly Project[];
  threads: readonly SidebarThreadSummary[];
  settings: ProjectContextSettings;
}): ProjectContextSummary[] {
  const contextIds = validContextIds(input.settings);
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
    const rawContextId =
      input.settings.projectContextAssignments[deriveProjectContextAssignmentKey(project)] ?? null;
    const contextId = rawContextId && contextIds.has(rawContextId) ? rawContextId : null;
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
    ...input.settings.projectContexts
      .slice()
      .sort(
        (left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name),
      )
      .map((context) => ensureSummary(context.id)),
  ];
}
