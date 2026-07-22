import {
  AVAILABLE_CONNECTION_STATE,
  EnvironmentSupervisor,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "@t3tools/client-runtime/connection";
import { type RpcSession, subscribe, type WsRpcProtocolClient } from "@t3tools/client-runtime/rpc";
import { EnvironmentId, type TerminalEvent, WS_METHODS } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});

const FIRST_EVENT: TerminalEvent = {
  type: "output",
  threadId: "thread-1",
  terminalId: "terminal-1",
  data: "first session",
};
const STALE_EVENT: TerminalEvent = {
  type: "output",
  threadId: "thread-1",
  terminalId: "terminal-1",
  data: "stale first session",
};
const SECOND_EVENT: TerminalEvent = {
  type: "output",
  threadId: "thread-1",
  terminalId: "terminal-1",
  data: "second session",
};

function session(client: WsRpcProtocolClient): RpcSession {
  return {
    client,
    initialConfig: Effect.never,
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };
}

describe("reconnect subscriptions", () => {
  it.effect("stops observing the previous live stream when the session is replaced", () =>
    Effect.gen(function* () {
      const subscriptions: string[] = [];
      const firstEvents = yield* Queue.unbounded<TerminalEvent>();
      const secondEvents = yield* Queue.unbounded<TerminalEvent>();
      const firstClient = {
        [WS_METHODS.subscribeTerminalEvents]: () => {
          subscriptions.push("first");
          return Stream.fromQueue(firstEvents);
        },
      } as unknown as WsRpcProtocolClient;
      const secondClient = {
        [WS_METHODS.subscribeTerminalEvents]: () => {
          subscriptions.push("second");
          return Stream.fromQueue(secondEvents);
        },
      } as unknown as WsRpcProtocolClient;
      const state = yield* SubscriptionRef.make<SupervisorConnectionState>(
        AVAILABLE_CONNECTION_STATE,
      );
      const activeSession = yield* SubscriptionRef.make<Option.Option<RpcSession>>(Option.none());
      const prepared = yield* SubscriptionRef.make<Option.Option<PreparedConnection>>(
        Option.none(),
      );
      const supervisor = EnvironmentSupervisor.of({
        target: TARGET,
        state,
        session: activeSession,
        prepared,
        connect: Effect.void,
        disconnect: Effect.void,
        retryNow: Effect.void,
      } satisfies EnvironmentSupervisor["Service"]);
      const observed = yield* Ref.make<TerminalEvent[]>([]);
      const awaitCount = Effect.fn("ReconnectSubscription.awaitCount")(function* (
        read: Effect.Effect<number>,
        count: number,
      ) {
        for (let attempt = 0; attempt < 100; attempt += 1) {
          if ((yield* read) >= count) {
            return;
          }
          yield* Effect.yieldNow;
        }
        return yield* Effect.die(new Error(`Expected count ${count}.`));
      });

      const subscriptionFiber = yield* subscribe(WS_METHODS.subscribeTerminalEvents, {}).pipe(
        Stream.runForEach((event) => Ref.update(observed, (events) => [...events, event])),
        Effect.provideService(EnvironmentSupervisor, supervisor),
        Effect.forkChild,
      );
      yield* SubscriptionRef.set(activeSession, Option.some(session(firstClient)));
      yield* awaitCount(
        Effect.sync(() => subscriptions.length),
        1,
      );
      yield* Queue.offer(firstEvents, FIRST_EVENT);
      yield* awaitCount(Ref.get(observed).pipe(Effect.map((events) => events.length)), 1);

      yield* SubscriptionRef.set(activeSession, Option.some(session(secondClient)));
      yield* awaitCount(
        Effect.sync(() => subscriptions.length),
        2,
      );
      yield* Queue.offer(firstEvents, STALE_EVENT);
      yield* Queue.offer(secondEvents, SECOND_EVENT);
      yield* awaitCount(Ref.get(observed).pipe(Effect.map((events) => events.length)), 2);
      yield* Fiber.interrupt(subscriptionFiber);

      expect(yield* Ref.get(observed)).toEqual([FIRST_EVENT, SECOND_EVENT]);
    }),
  );
});
