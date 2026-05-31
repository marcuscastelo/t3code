import {
  CommandId,
  EventId,
  type OrchestrationEvent,
  type ProjectScriptHookEvent,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { ProjectHookRunner } from "../../project/Services/ProjectHookRunner.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  ProjectHookReactor,
  type ProjectHookReactorShape,
} from "../Services/ProjectHookReactor.ts";

type HookableTurnEvent = Extract<
  OrchestrationEvent,
  { type: "thread.turn-start-requested" | "thread.turn-diff-completed" }
>;

const hookEventForDomainEvent = (event: HookableTurnEvent): ProjectScriptHookEvent =>
  event.type === "thread.turn-start-requested" ? "thread.turn.started" : "thread.turn.completed";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const randomUUID = crypto.randomUUIDv4;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectHookRunner = yield* ProjectHookRunner;

  const serverCommandId = (tag: string) =>
    randomUUID.pipe(Effect.map((uuid) => CommandId.make(`server:${tag}:${uuid}`)));
  const serverEventId = (tag: string) =>
    randomUUID.pipe(Effect.map((uuid) => EventId.make(`server:${tag}:${uuid}`)));

  const recordHookFailure = (event: HookableTurnEvent, detail: string) =>
    Effect.gen(function* () {
      const createdAt = yield* nowIso;
      yield* orchestrationEngine.dispatch({
        type: "thread.activity.append",
        commandId: yield* serverCommandId("project-hook-failed"),
        threadId: event.payload.threadId,
        activity: {
          id: yield* serverEventId("project-hook-failed"),
          tone: "error",
          kind: "hook.failed",
          summary: "Project hook failed to start",
          payload: {
            hookEvent: hookEventForDomainEvent(event),
            sourceEventId: event.eventId,
            sourceEventType: event.type,
            detail,
          },
          turnId: event.type === "thread.turn-diff-completed" ? event.payload.turnId : null,
          createdAt,
        },
        createdAt,
      });
    }).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("project hook reactor failed to record hook failure", {
          eventType: event.type,
          threadId: event.payload.threadId,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const processEvent = Effect.fn("processProjectHookEvent")(function* (event: HookableTurnEvent) {
    const hookEvent = hookEventForDomainEvent(event);
    const result = yield* projectHookRunner
      .runForThread({
        event: hookEvent,
        hookRunId: event.eventId,
        threadId: event.payload.threadId,
        payload: event,
      })
      .pipe(Effect.result);

    if (result._tag === "Failure") {
      yield* Effect.logWarning("project hook failed to start", {
        hookEvent,
        eventType: event.type,
        threadId: event.payload.threadId,
        detail: result.failure.message,
      });
      yield* recordHookFailure(event, result.failure.message);
    }
  });

  const processEventSafely = (event: HookableTurnEvent) =>
    processEvent(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("project hook reactor failed to process event", {
          eventType: event.type,
          threadId: event.payload.threadId,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processEventSafely);

  const start: ProjectHookReactorShape["start"] = Effect.fn("start")(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (
          event.type !== "thread.turn-start-requested" &&
          event.type !== "thread.turn-diff-completed"
        ) {
          return Effect.void;
        }
        return worker.enqueue(event);
      }),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies ProjectHookReactorShape;
});

export const ProjectHookReactorLive = Layer.effect(ProjectHookReactor, make);
