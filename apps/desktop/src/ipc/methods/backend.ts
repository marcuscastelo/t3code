import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopBackendManager from "../../backend/DesktopBackendManager.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

export const startLocalServer = makeIpcMethod({
  channel: IpcChannels.START_LOCAL_SERVER_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: () =>
    Effect.gen(function* () {
      const manager = yield* DesktopBackendManager.DesktopBackendManager;
      yield* manager.start;
    }),
});
