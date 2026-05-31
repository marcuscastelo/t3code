/**
 * ProjectHookReactor - Project script hook reactor service interface.
 *
 * Owns background workers that react to turn lifecycle domain events and launch
 * configured project scripts.
 *
 * @module ProjectHookReactor
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface ProjectHookReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
}

export class ProjectHookReactor extends Context.Service<
  ProjectHookReactor,
  ProjectHookReactorShape
>()("t3/orchestration/Services/ProjectHookReactor") {}
