import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { ProjectContextId } from "@t3tools/contracts/settings";
import { describe, expect, it } from "vitest";
import type { Project, SidebarThreadSummary } from "./types";
import { DEFAULT_INTERACTION_MODE } from "./types";
import {
  assignProjectToContext,
  applyProjectContextRules,
  buildProjectContextSummaries,
  createProjectContext,
  createProjectContextRule,
  deriveProjectContextAssignmentKey,
  deriveProjectContextAssignmentKeys,
  doesProjectMatchContextRule,
  filterProjectsByActiveProjectContext,
  removeProjectContext,
  renameProjectContext,
  reorderProjectContext,
  resolveProjectContextAddProjectBaseDirectory,
  resolveProjectContextDefaultThreadEnvMode,
  resolveProjectContextId,
  type ProjectContextSettings,
} from "./projectContexts";

const primaryEnvId = EnvironmentId.make("env-primary");
const remoteEnvId = EnvironmentId.make("env-remote");
const workContextId = ProjectContextId.make("work");
const startupContextId = ProjectContextId.make("startup");

function makeProject(
  overrides: Partial<Project> & Pick<Project, "id" | "environmentId" | "name" | "cwd">,
): Project {
  return {
    defaultModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scripts: [],
    repositoryIdentity: null,
    ...overrides,
  };
}

function makeThread(
  overrides: Partial<SidebarThreadSummary> &
    Pick<SidebarThreadSummary, "id" | "environmentId" | "projectId" | "title">,
): SidebarThreadSummary {
  return {
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    worktreeOwnership: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

function makeSettings(overrides: Partial<ProjectContextSettings> = {}): ProjectContextSettings {
  return {
    projectContexts: [
      { id: workContextId, name: "Work", sortOrder: 0 },
      { id: startupContextId, name: "Startup", sortOrder: 1 },
    ],
    activeProjectContextId: null,
    projectContextAssignments: {},
    projectContextProjectOverrides: {},
    projectContextDefaults: {},
    projectContextRules: [],
    managedWorktreeBaseDirectory: "",
    ...overrides,
  };
}

describe("projectContexts", () => {
  it("uses repository identity as the assignment key across environments", () => {
    const localProject = makeProject({
      id: ProjectId.make("local"),
      environmentId: primaryEnvId,
      name: "shared",
      cwd: "/workspace/shared",
      repositoryIdentity: {
        canonicalKey: "github.com/acme/shared",
        locator: {
          source: "git-remote",
          remoteName: "origin",
          remoteUrl: "https://github.com/acme/shared.git",
        },
      },
    });
    const remoteProject = makeProject({
      id: ProjectId.make("remote"),
      environmentId: remoteEnvId,
      name: "shared",
      cwd: "/srv/shared",
      repositoryIdentity: {
        canonicalKey: "github.com/acme/shared",
        locator: {
          source: "git-remote",
          remoteName: "origin",
          remoteUrl: "https://github.com/acme/shared.git",
        },
      },
    });
    const personalProject = makeProject({
      id: ProjectId.make("personal"),
      environmentId: primaryEnvId,
      name: "personal",
      cwd: "/workspace/personal",
    });

    const assignments = assignProjectToContext({
      project: localProject,
      contextId: workContextId,
      assignments: {},
    });
    const settings = makeSettings({
      activeProjectContextId: workContextId,
      projectContextAssignments: assignments,
    });

    expect(deriveProjectContextAssignmentKey(localProject)).toBe(
      deriveProjectContextAssignmentKey(remoteProject),
    );
    expect(resolveProjectContextId(remoteProject, settings)).toBe(workContextId);
    expect(
      filterProjectsByActiveProjectContext(
        [localProject, remoteProject, personalProject],
        settings,
      ),
    ).toEqual([localProject, remoteProject]);
  });

  it("keeps path fallback assignments for projects that gain repository identity later", () => {
    const projectWithoutRepository = makeProject({
      id: ProjectId.make("project"),
      environmentId: primaryEnvId,
      name: "app",
      cwd: "/workspace/app",
    });
    const projectWithRepository = makeProject({
      id: projectWithoutRepository.id,
      environmentId: projectWithoutRepository.environmentId,
      name: projectWithoutRepository.name,
      cwd: projectWithoutRepository.cwd,
      repositoryIdentity: {
        canonicalKey: "github.com/acme/app",
        locator: {
          source: "git-remote",
          remoteName: "origin",
          remoteUrl: "https://github.com/acme/app.git",
        },
      },
    });

    const assignments = assignProjectToContext({
      project: projectWithoutRepository,
      contextId: startupContextId,
      assignments: {},
    });

    expect(deriveProjectContextAssignmentKeys(projectWithRepository)).toEqual([
      "repo:github.com/acme/app",
      deriveProjectContextAssignmentKey(projectWithoutRepository),
    ]);
    expect(
      resolveProjectContextId(
        projectWithRepository,
        makeSettings({ projectContextAssignments: assignments }),
      ),
    ).toBe(startupContextId);
  });

  it("falls back to physical path keys when a repository identity is unavailable", () => {
    const localProject = makeProject({
      id: ProjectId.make("local"),
      environmentId: primaryEnvId,
      name: "scratch",
      cwd: "/workspace/scratch",
    });
    const remoteProject = makeProject({
      id: ProjectId.make("remote"),
      environmentId: remoteEnvId,
      name: "scratch",
      cwd: "/workspace/scratch",
    });

    expect(deriveProjectContextAssignmentKey(localProject)).not.toBe(
      deriveProjectContextAssignmentKey(remoteProject),
    );
  });

  it("builds summaries for all contexts and excludes archived threads", () => {
    const workProject = makeProject({
      id: ProjectId.make("work-project"),
      environmentId: primaryEnvId,
      name: "work",
      cwd: "/workspace/work",
    });
    const startupProject = makeProject({
      id: ProjectId.make("startup-project"),
      environmentId: primaryEnvId,
      name: "startup",
      cwd: "/workspace/startup",
    });
    const assignments = assignProjectToContext({
      project: workProject,
      contextId: workContextId,
      assignments: assignProjectToContext({
        project: startupProject,
        contextId: startupContextId,
        assignments: {},
      }),
    });

    const summaries = buildProjectContextSummaries({
      projects: [workProject, startupProject],
      threads: [
        makeThread({
          id: ThreadId.make("work-thread"),
          environmentId: primaryEnvId,
          projectId: workProject.id,
          title: "Work thread",
        }),
        makeThread({
          id: ThreadId.make("archived-work-thread"),
          environmentId: primaryEnvId,
          projectId: workProject.id,
          title: "Archived",
          archivedAt: "2026-01-02T00:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("startup-thread"),
          environmentId: primaryEnvId,
          projectId: startupProject.id,
          title: "Startup thread",
        }),
      ],
      settings: makeSettings({ projectContextAssignments: assignments }),
    });

    expect(summaries).toMatchObject([
      { contextId: null, projectCount: 2, threadCount: 2 },
      { contextId: workContextId, projectCount: 1, threadCount: 1 },
      { contextId: startupContextId, projectCount: 1, threadCount: 1 },
    ]);
  });

  it("creates stable unique ids from names", () => {
    const context = createProjectContext({
      name: "Empresa Principal",
      existingContexts: [{ id: ProjectContextId.make("empresa-principal"), sortOrder: 0 }],
    });

    expect(context).toEqual({
      id: ProjectContextId.make("empresa-principal-2"),
      name: "Empresa Principal",
      sortOrder: 1,
    });
  });

  it("renames and reorders contexts without changing ids", () => {
    const renamed = renameProjectContext({
      contexts: makeSettings().projectContexts,
      contextId: workContextId,
      name: "Main Company",
    });
    expect(renamed.find((context) => context.id === workContextId)?.name).toBe("Main Company");

    const reordered = reorderProjectContext({
      contexts: renamed,
      contextId: startupContextId,
      direction: "up",
    });

    expect(reordered.map((context) => [context.id, context.sortOrder])).toEqual([
      [startupContextId, 0],
      [workContextId, 1],
    ]);
  });

  it("removes contexts and moves assignments to the chosen replacement", () => {
    const workProject = makeProject({
      id: ProjectId.make("work-project"),
      environmentId: primaryEnvId,
      name: "work",
      cwd: "/workspace/work",
    });
    const startupProject = makeProject({
      id: ProjectId.make("startup-project"),
      environmentId: primaryEnvId,
      name: "startup",
      cwd: "/workspace/startup",
    });
    const settings = makeSettings({
      activeProjectContextId: startupContextId,
      projectContextAssignments: assignProjectToContext({
        project: workProject,
        contextId: workContextId,
        assignments: assignProjectToContext({
          project: startupProject,
          contextId: startupContextId,
          assignments: {},
        }),
      }),
    });

    const patch = removeProjectContext({
      settings,
      contextId: startupContextId,
      replacementContextId: workContextId,
    });

    expect(patch.projectContexts.map((context) => context.id)).toEqual([workContextId]);
    expect(patch.activeProjectContextId).toBe(workContextId);
    expect(resolveProjectContextId(startupProject, { ...settings, ...patch })).toBe(workContextId);
    expect(patch.projectContextRules).toEqual([]);
  });

  it("resolves workspace defaults over global fallbacks", () => {
    const settings = makeSettings({
      projectContextDefaults: {
        [workContextId]: {
          defaultThreadEnvMode: "worktree",
          addProjectBaseDirectory: "~/work",
        },
      },
    });

    expect(resolveProjectContextDefaultThreadEnvMode(settings, workContextId, "local")).toBe(
      "worktree",
    );
    expect(resolveProjectContextDefaultThreadEnvMode(settings, startupContextId, "local")).toBe(
      "local",
    );
    expect(resolveProjectContextAddProjectBaseDirectory(settings, workContextId, "~/")).toBe(
      "~/work",
    );
  });

  it("matches projects with path, repository, and remote-url rules", () => {
    const project = makeProject({
      id: ProjectId.make("project"),
      environmentId: primaryEnvId,
      name: "app",
      cwd: "/Users/me/work/acme/app",
      repositoryIdentity: {
        canonicalKey: "github.com/acme/app",
        locator: {
          source: "git-remote",
          remoteName: "origin",
          remoteUrl: "git@github.com:acme/app.git",
        },
      },
    });

    expect(
      doesProjectMatchContextRule(project, { kind: "path_prefix", pattern: "/users/me/work" }),
    ).toBe(true);
    expect(
      doesProjectMatchContextRule(project, {
        kind: "repository_prefix",
        pattern: "github.com/acme/",
      }),
    ).toBe(true);
    expect(
      doesProjectMatchContextRule(project, {
        kind: "remote_url_contains",
        pattern: "github.com:acme",
      }),
    ).toBe(true);
  });

  it("applies the first matching rule to unassigned projects", () => {
    const workProject = makeProject({
      id: ProjectId.make("work-project"),
      environmentId: primaryEnvId,
      name: "work",
      cwd: "/Users/me/work/acme/app",
    });
    const startupProject = makeProject({
      id: ProjectId.make("startup-project"),
      environmentId: primaryEnvId,
      name: "startup",
      cwd: "/Users/me/startup/app",
      repositoryIdentity: {
        canonicalKey: "github.com/startup/app",
        locator: {
          source: "git-remote",
          remoteName: "origin",
          remoteUrl: "https://github.com/startup/app.git",
        },
      },
    });
    const workRule = createProjectContextRule({
      contextId: workContextId,
      kind: "path_prefix",
      pattern: "/Users/me/work",
      existingRules: [],
    });
    const startupRule = createProjectContextRule({
      contextId: startupContextId,
      kind: "repository_prefix",
      pattern: "github.com/startup/",
      existingRules: [workRule],
    });
    const settings = makeSettings({
      projectContextRules: [workRule, startupRule],
    });

    const assignments = applyProjectContextRules({
      projects: [workProject, startupProject],
      settings,
      overwriteExisting: false,
    });

    expect(
      resolveProjectContextId(workProject, {
        ...settings,
        projectContextAssignments: assignments,
      }),
    ).toBe(workContextId);
    expect(
      resolveProjectContextId(startupProject, {
        ...settings,
        projectContextAssignments: assignments,
      }),
    ).toBe(startupContextId);
  });
});
