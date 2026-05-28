import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { vi } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type * as Electron from "electron";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronTheme from "../electron/ElectronTheme.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import * as DesktopConfig from "./DesktopConfig.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopLifecycle from "./DesktopLifecycle.ts";
import * as DesktopState from "./DesktopState.ts";

vi.mock("electron", () => ({
  app: {},
  nativeTheme: {
    on: () => undefined,
    removeListener: () => undefined,
    shouldUseDarkColors: false,
    themeSource: "system",
  },
}));

const environmentInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "linux",
  processArch: "arm64",
  appVersion: "1.2.3",
  appPath: "/repo",
  isPackaged: false,
  resourcesPath: "/repo/resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

describe("DesktopLifecycle", () => {
  it.effect("keeps the app running when the last window closes", () =>
    Effect.gen(function* () {
      const listeners = new Map<string, (...args: readonly unknown[]) => void>();
      let quitCount = 0;

      const electronAppLayer = Layer.succeed(ElectronApp.ElectronApp, {
        metadata: Effect.die("unexpected metadata"),
        name: Effect.succeed("T3 Code"),
        whenReady: Effect.void,
        quit: Effect.sync(() => {
          quitCount += 1;
        }),
        exit: () => Effect.void,
        relaunch: () => Effect.void,
        setPath: () => Effect.void,
        setName: () => Effect.void,
        setAboutPanelOptions: () => Effect.void,
        setAppUserModelId: () => Effect.void,
        setDesktopName: () => Effect.void,
        setDockIcon: () => Effect.void,
        appendCommandLineSwitch: () => Effect.void,
        on: (eventName, listener) =>
          Effect.sync(() => {
            listeners.set(eventName, listener as (...args: readonly unknown[]) => void);
          }),
      } satisfies ElectronApp.ElectronAppShape);

      const layer = DesktopLifecycle.layer.pipe(
        Layer.provideMerge(DesktopLifecycle.layerShutdown),
        Layer.provideMerge(DesktopState.layer),
        Layer.provideMerge(
          Layer.succeed(DesktopWindow.DesktopWindow, {
            createMain: Effect.die("unexpected createMain"),
            ensureMain: Effect.die("unexpected ensureMain"),
            revealOrCreateMain: Effect.die("unexpected revealOrCreateMain"),
            activate: Effect.void,
            createMainIfBackendReady: Effect.void,
            handleBackendReady: Effect.void,
            dispatchMenuAction: () => Effect.void,
            syncAppearance: Effect.void,
          } satisfies DesktopWindow.DesktopWindowShape),
        ),
        Layer.provideMerge(electronAppLayer),
        Layer.provideMerge(
          Layer.succeed(ElectronTheme.ElectronTheme, {
            shouldUseDarkColors: Effect.succeed(false),
            onUpdated: () => Effect.void,
            setSource: () => Effect.void,
          } satisfies ElectronTheme.ElectronThemeShape),
        ),
        Layer.provideMerge(
          DesktopEnvironment.layer(environmentInput).pipe(
            Layer.provide(Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({}))),
          ),
        ),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
          yield* lifecycle.register;
          const windowAllClosed = listeners.get("window-all-closed");
          assert.isDefined(windowAllClosed);
          windowAllClosed({} as Electron.Event);
          yield* Effect.yieldNow;
          assert.equal(quitCount, 0);
        }),
      ).pipe(Effect.provide(layer));
    }),
  );
});
