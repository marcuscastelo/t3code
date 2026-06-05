import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { ProjectContextId } from "@t3tools/contracts/settings";
import { describe, expect, it } from "vitest";
import type { Project, SidebarThreadSummary } from "./types";
import { DEFAULT_INTERACTION_MODE } from "./types";
import {
  assignProjectToContext,
  buildProjectContextSummaries,
  createProjectContext,
  deriveProjectContextAssignmentKey,
  filterProjectsByActiveProjectContext,
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
});
