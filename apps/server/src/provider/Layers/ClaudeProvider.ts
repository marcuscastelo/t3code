import {
  type ClaudeSettings,
  type ModelCapabilities,
  type ModelSelection,
  ProviderDriverKind,
  type ServerProviderModel,
  type ServerProviderSlashCommand,
} from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import {
  createModelCapabilities,
  getModelSelectionStringOptionValue,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
} from "@t3tools/shared/model";
import { compareSemverVersions } from "@t3tools/shared/semver";
import {
  query as claudeQuery,
  type SlashCommand as ClaudeSlashCommand,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

import {
  buildBooleanOptionDescriptor,
  buildSelectOptionDescriptor,
  buildServerProvider,
  DEFAULT_TIMEOUT_MS,
  detailFromResult,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import { makeClaudeEnvironment } from "../Drivers/ClaudeHome.ts";

const DEFAULT_CLAUDE_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

const PROVIDER = ProviderDriverKind.make("claudeAgent");
const CLAUDE_PRESENTATION = {
  displayName: "Claude",
  showInteractionModeToggle: true,
} as const;
const MINIMUM_CLAUDE_OPUS_4_8_VERSION = "2.1.154";
const MINIMUM_CLAUDE_OPUS_4_7_VERSION = "2.1.111";

const CLAUDE_EFFORT_OPTIONS = {
  opus48: [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High", isDefault: true },
    { value: "xhigh", label: "Extra High" },
    { value: "max", label: "Max" },
    { value: "ultracode", label: "Ultracode" },
    { value: "ultrathink", label: "Ultrathink" },
  ],
  opus47: [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "xhigh", label: "Extra High", isDefault: true },
    { value: "max", label: "Max" },
    { value: "ultrathink", label: "Ultrathink" },
  ],
  opus46: [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High", isDefault: true },
    { value: "max", label: "Max" },
    { value: "ultrathink", label: "Ultrathink" },
  ],
  sonnet46: [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High", isDefault: true },
    { value: "max", label: "Max" },
    { value: "ultrathink", label: "Ultrathink" },
  ],
  opus45: [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High", isDefault: true },
    { value: "max", label: "Max" },
  ],
} as const;

const CLAUDE_USAGE_PROBE_TIMEOUT_MS = 14_000;
const BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "claude-opus-4-8",
    name: "Claude Opus 4.8",
    isCustom: false,
    capabilities: createModelCapabilities({
      optionDescriptors: [
        buildSelectOptionDescriptor({
          id: "effort",
          label: "Reasoning",
          options: CLAUDE_EFFORT_OPTIONS.opus48,
          promptInjectedValues: ["ultrathink"],
        }),
        buildSelectOptionDescriptor({
          id: "contextWindow",
          label: "Context Window",
          options: [
            { value: "200k", label: "200k", isDefault: true },
            { value: "1m", label: "1M" },
          ],
        }),
      ],
    }),
  },
  {
    slug: "claude-opus-4-7",
    name: "Claude Opus 4.7",
    isCustom: false,
    capabilities: createModelCapabilities({
      optionDescriptors: [
        buildSelectOptionDescriptor({
          id: "effort",
          label: "Reasoning",
          options: CLAUDE_EFFORT_OPTIONS.opus47,
          promptInjectedValues: ["ultrathink"],
        }),
        buildSelectOptionDescriptor({
          id: "contextWindow",
          label: "Context Window",
          options: [
            { value: "200k", label: "200k", isDefault: true },
            { value: "1m", label: "1M" },
          ],
        }),
      ],
    }),
  },
  {
    slug: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    isCustom: false,
    capabilities: createModelCapabilities({
      optionDescriptors: [
        buildSelectOptionDescriptor({
          id: "effort",
          label: "Reasoning",
          options: CLAUDE_EFFORT_OPTIONS.opus46,
          promptInjectedValues: ["ultrathink"],
        }),
        buildBooleanOptionDescriptor({
          id: "fastMode",
          label: "Fast Mode",
        }),
        buildSelectOptionDescriptor({
          id: "contextWindow",
          label: "Context Window",
          options: [
            { value: "200k", label: "200k", isDefault: true },
            { value: "1m", label: "1M" },
          ],
        }),
      ],
    }),
  },
  {
    slug: "claude-opus-4-5",
    name: "Claude Opus 4.5",
    isCustom: false,
    capabilities: createModelCapabilities({
      optionDescriptors: [
        buildSelectOptionDescriptor({
          id: "effort",
          label: "Reasoning",
          options: CLAUDE_EFFORT_OPTIONS.opus45,
        }),
        buildBooleanOptionDescriptor({
          id: "fastMode",
          label: "Fast Mode",
        }),
      ],
    }),
  },
  {
    slug: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    isCustom: false,
    capabilities: createModelCapabilities({
      optionDescriptors: [
        buildSelectOptionDescriptor({
          id: "effort",
          label: "Reasoning",
          options: CLAUDE_EFFORT_OPTIONS.sonnet46,
          promptInjectedValues: ["ultrathink"],
        }),
        buildSelectOptionDescriptor({
          id: "contextWindow",
          label: "Context Window",
          options: [
            { value: "200k", label: "200k", isDefault: true },
            { value: "1m", label: "1M" },
          ],
        }),
      ],
    }),
  },
  {
    slug: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    isCustom: false,
    capabilities: createModelCapabilities({
      optionDescriptors: [
        buildBooleanOptionDescriptor({
          id: "thinking",
          label: "Thinking",
        }),
      ],
    }),
  },
];

function supportsClaudeOpus48(version: string | null | undefined): boolean {
  return version ? compareSemverVersions(version, MINIMUM_CLAUDE_OPUS_4_8_VERSION) >= 0 : false;
}

function supportsClaudeOpus47(version: string | null | undefined): boolean {
  return version ? compareSemverVersions(version, MINIMUM_CLAUDE_OPUS_4_7_VERSION) >= 0 : false;
}

function getBuiltInClaudeModelsForVersion(
  version: string | null | undefined,
): ReadonlyArray<ServerProviderModel> {
  return BUILT_IN_MODELS.filter((model) => {
    if (model.slug === "claude-opus-4-8") {
      return supportsClaudeOpus48(version);
    }
    if (model.slug === "claude-opus-4-7") {
      return supportsClaudeOpus47(version);
    }
    return true;
  });
}

function formatClaudeOpus48UpgradeMessage(version: string | null): string {
  const versionLabel = version ? `v${version}` : "the installed version";
  return `Claude Code ${versionLabel} is too old for Claude Opus 4.8. Upgrade to v${MINIMUM_CLAUDE_OPUS_4_8_VERSION} or newer to access it.`;
}

function formatClaudeOpus47UpgradeMessage(version: string | null): string {
  const versionLabel = version ? `v${version}` : "the installed version";
  return `Claude Code ${versionLabel} is too old for Claude Opus 4.7. Upgrade to v${MINIMUM_CLAUDE_OPUS_4_7_VERSION} or newer to access it.`;
}

export function getClaudeModelCapabilities(model: string | null | undefined): ModelCapabilities {
  const slug = model?.trim();
  return (
    BUILT_IN_MODELS.find((candidate) => candidate.slug === slug)?.capabilities ??
    DEFAULT_CLAUDE_MODEL_CAPABILITIES
  );
}

export function resolveClaudeEffort(
  caps: ModelCapabilities,
  raw: string | null | undefined,
): string | undefined {
  const descriptors = getProviderOptionDescriptors({
    caps,
    ...(raw ? { selections: [{ id: "effort", value: raw }] } : {}),
  });
  const effortDescriptor = descriptors.find((descriptor) => descriptor.id === "effort");
  const value = getProviderOptionCurrentValue(effortDescriptor);
  return typeof value === "string" ? value : undefined;
}

/**
 * Normalize a resolved Claude effort value into one suitable for the Claude
 * CLI's `--effort` flag.
 *
 * Mirrors the mapping used when invoking the Claude Agent SDK
 * ({@link getEffectiveClaudeAgentEffort} in ClaudeAdapter): `ultracode` is a
 * Claude Code setting that pairs with `xhigh`, `ultrathink` is filtered out
 * because it is a prompt-prefix mode, and older model compatibility mappings
 * are preserved for current Claude Code behavior.
 */
export function normalizeClaudeCliEffort(
  effort: string | null | undefined,
  model: string | null | undefined,
): string | undefined {
  if (!effort || effort === "ultrathink") {
    return undefined;
  }
  if (effort === "ultracode") {
    return "xhigh";
  }
  if (effort === "xhigh" && model !== "claude-opus-4-8") {
    return "max";
  }
  if (effort === "max" && model === "claude-sonnet-4-6") {
    return "high";
  }
  return effort;
}

export function isClaudeUltracodeEffort(effort: string | null | undefined): boolean {
  return effort === "ultracode";
}

export function resolveClaudeApiModelId(modelSelection: ModelSelection): string {
  switch (getModelSelectionStringOptionValue(modelSelection, "contextWindow")) {
    case "1m":
      return `${modelSelection.model}[1m]`;
    default:
      return modelSelection.model;
  }
}

function toTitleCaseWords(value: string): string {
  const parts: Array<string> = [];
  for (const part of value.split(/[\s_-]+/g)) {
    if (part.length > 0) {
      parts.push(part[0]!.toUpperCase() + part.slice(1).toLowerCase());
    }
  }
  return parts.join(" ");
}

function claudeSubscriptionLabel(subscriptionType: string | undefined): string | undefined {
  const normalized = subscriptionType?.toLowerCase().replace(/[\s_-]+/g, "");
  if (!normalized) return undefined;

  switch (normalized) {
    case "claudemaxsubscription":
      return "Max";
    case "claudemax5xsubscription":
      return "Max 5x";
    case "claudemax20xsubscription":
      return "Max 20x";
    case "claudeenterprisesubscription":
      return "Enterprise";
    case "claudeteamsubscription":
      return "Team";
    case "claudeprosubscription":
      return "Pro";
    case "claudefreesubscription":
      return "Free";
    case "max":
    case "maxplan":
      return "Max";
    case "max5":
      return "Max 5x";
    case "max20":
      return "Max 20x";
    case "enterprise":
      return "Enterprise";
    case "team":
      return "Team";
    case "pro":
      return "Pro";
    case "free":
      return "Free";
    default:
      return toTitleCaseWords(subscriptionType!);
  }
}

function normalizeClaudeAuthMethod(authMethod: string | undefined): string | undefined {
  const normalized = authMethod?.toLowerCase().replace(/[\s_-]+/g, "");
  if (!normalized) return undefined;
  if (
    normalized === "apikey" ||
    normalized === "anthropicapikey" ||
    normalized === "anthropicauthtoken"
  ) {
    return "apiKey";
  }
  return undefined;
}

function formatClaudeSubscriptionAuthLabel(subscriptionType: string): string {
  const subscriptionLabel =
    claudeSubscriptionLabel(subscriptionType) ?? toTitleCaseWords(subscriptionType);
  const normalized = subscriptionLabel.toLowerCase().replace(/[\s_-]+/g, "");

  if (normalized.startsWith("claude") && normalized.endsWith("subscription")) {
    return subscriptionLabel;
  }
  if (normalized.startsWith("claude")) {
    return `${subscriptionLabel} Subscription`;
  }
  if (normalized.endsWith("subscription")) {
    return `Claude ${subscriptionLabel}`;
  }
  return `Claude ${subscriptionLabel} Subscription`;
}

function claudeAuthMetadata(input: {
  readonly subscriptionType: string | undefined;
  readonly authMethod: string | undefined;
}): { readonly type: string; readonly label: string } | undefined {
  if (normalizeClaudeAuthMethod(input.authMethod) === "apiKey") {
    return {
      type: "apiKey",
      label: "Claude API Key",
    };
  }

  if (input.subscriptionType) {
    return {
      type: input.subscriptionType,
      label: formatClaudeSubscriptionAuthLabel(input.subscriptionType),
    };
  }

  return undefined;
}

// ── SDK capability probe ────────────────────────────────────────────

const CAPABILITIES_PROBE_TIMEOUT_MS = 8_000;

function nonEmptyProbeString(value: string): string | undefined {
  const candidate = value.trim();
  return candidate ? candidate : undefined;
}

type ClaudeCapabilitiesProbe = {
  readonly email: string | undefined;
  readonly subscriptionType: string | undefined;
  readonly tokenSource: string | undefined;
  readonly slashCommands: ReadonlyArray<ServerProviderSlashCommand>;
};

type ClaudeRateLimitProbeWindow = {
  readonly id: string;
  readonly label: string;
  readonly usedPercent: number;
  readonly resetsAtText?: string;
  readonly windowDurationMins: number | null;
};

type ClaudeRateLimitProbe = {
  readonly rateLimits: {
    readonly source: "claude-cli-usage";
    readonly windows: ReadonlyArray<ClaudeRateLimitProbeWindow>;
  };
};

class ClaudeCliUsageProbeError extends Data.TaggedError("ClaudeCliUsageProbeError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

function noopCleanup() {}

function parseClaudeInitializationCommands(
  commands: ReadonlyArray<ClaudeSlashCommand> | undefined,
): ReadonlyArray<ServerProviderSlashCommand> {
  return dedupeSlashCommands(
    (commands ?? []).flatMap((command) => {
      const name = nonEmptyProbeString(command.name);
      if (!name) {
        return [];
      }

      const description = nonEmptyProbeString(command.description);
      const argumentHint = nonEmptyProbeString(command.argumentHint);

      return [
        {
          name,
          ...(description ? { description } : {}),
          ...(argumentHint ? { input: { hint: argumentHint } } : {}),
        } satisfies ServerProviderSlashCommand,
      ];
    }),
  );
}

function dedupeSlashCommands(
  commands: ReadonlyArray<ServerProviderSlashCommand>,
): ReadonlyArray<ServerProviderSlashCommand> {
  const commandsByName = new Map<string, ServerProviderSlashCommand>();

  for (const command of commands) {
    const name = nonEmptyProbeString(command.name);
    if (!name) {
      continue;
    }

    const key = name.toLowerCase();
    const existing = commandsByName.get(key);
    if (!existing) {
      commandsByName.set(key, {
        ...command,
        name,
      });
      continue;
    }

    commandsByName.set(key, {
      ...existing,
      ...(existing.description
        ? {}
        : command.description
          ? { description: command.description }
          : {}),
      ...(existing.input?.hint
        ? {}
        : command.input?.hint
          ? { input: { hint: command.input.hint } }
          : {}),
    });
  }

  return [...commandsByName.values()];
}

function waitForAbortSignal(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

/**
 * Probe account information by spawning a lightweight Claude Agent SDK
 * session and reading the initialization result.
 *
 * We pass a never-yielding AsyncIterable as the prompt so that no user
 * message is ever written to the subprocess stdin. This means the Claude
 * Code subprocess completes its local initialization IPC (returning
 * account info and slash commands) but never starts an API request to
 * Anthropic. We read the init data and then abort the subprocess.
 *
 * This is used as a fallback when `claude auth status` does not include
 * subscription type information.
 */
const probeClaudeCapabilities = (
  claudeSettings: ClaudeSettings,
  environment: NodeJS.ProcessEnv = process.env,
) => {
  const abort = new AbortController();
  return Effect.gen(function* () {
    const claudeEnvironment = yield* makeClaudeEnvironment(claudeSettings, environment);
    return yield* Effect.tryPromise(async () => {
      const q = claudeQuery({
        // Never yield — we only need initialization data, not a conversation.
        // This prevents any prompt from reaching the Anthropic API.
        // oxlint-disable-next-line require-yield
        prompt: (async function* (): AsyncGenerator<SDKUserMessage> {
          await waitForAbortSignal(abort.signal);
        })(),
        options: {
          persistSession: false,
          pathToClaudeCodeExecutable: claudeSettings.binaryPath,
          abortController: abort,
          settingSources: ["user", "project", "local"],
          allowedTools: [],
          env: claudeEnvironment,
          stderr: () => {},
        },
      });
      const init = await q.initializationResult();
      const account = init.account as
        | {
            readonly email?: string;
            readonly subscriptionType?: string;
            readonly tokenSource?: string;
          }
        | undefined;
      return {
        email: account?.email,
        subscriptionType: account?.subscriptionType,
        tokenSource: account?.tokenSource,
        slashCommands: parseClaudeInitializationCommands(init.commands),
      } satisfies ClaudeCapabilitiesProbe;
    });
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        if (!abort.signal.aborted) abort.abort();
      }),
    ),
    Effect.timeoutOption(CAPABILITIES_PROBE_TIMEOUT_MS),
    Effect.result,
    Effect.map((result) => {
      if (Result.isFailure(result)) return undefined;
      return Option.isSome(result.success) ? result.success.value : undefined;
    }),
  );
};

function stripAnsiCodes(value: string): string {
  let clean = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 27) {
      const next = value[index + 1];
      if (next === "[") {
        index += 2;
        while (index < value.length && !/[A-Za-z~]/.test(value[index]!)) {
          index += 1;
        }
        continue;
      }
      if (next === "]") {
        index += 2;
        while (index < value.length) {
          const currentCode = value.charCodeAt(index);
          if (currentCode === 7) break;
          if (currentCode === 27 && value[index + 1] === "\\") {
            index += 1;
            break;
          }
          index += 1;
        }
        continue;
      }
      index += 1;
      continue;
    }
    clean += value[index] === "\r" ? "\n" : value[index];
  }
  return clean;
}

function normalizeForUsageLabelSearch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function percentToUsedPercent(percent: number, keyword: string | undefined): number {
  const normalizedKeyword = keyword?.toLowerCase();
  const used =
    normalizedKeyword === "left" ||
    normalizedKeyword === "remaining" ||
    normalizedKeyword === "available"
      ? 100 - percent
      : percent;
  return Math.max(0, Math.min(100, used));
}

function parseUsagePercent(value: string): number | null {
  const percentagePattern =
    /(\d+(?:\.\d+)?)\s*%\s*(used|left|remaining|available)?|(used|left|remaining|available)\D{0,24}(\d+(?:\.\d+)?)\s*%/gi;
  for (const match of value.matchAll(percentagePattern)) {
    const rawPercent = match[1] ?? match[4];
    const percent = rawPercent ? Number(rawPercent) : Number.NaN;
    if (!Number.isFinite(percent)) {
      continue;
    }
    return percentToUsedPercent(percent, match[2] ?? match[3]);
  }
  return null;
}

function parseUsageResetText(value: string): string | undefined {
  const match = /Resets[^\n)]*(?:\([^)]+\))?/i.exec(value);
  return match?.[0]?.trim();
}

function usageCaptureHasSessionValue(value: string): boolean {
  const normalized = normalizeForUsageLabelSearch(stripAnsiCodes(value));
  return normalized.includes("currentsession") && /(?:used|left|remaining|available)/i.test(value);
}

function usageCaptureHasWeeklyValue(value: string): boolean {
  const normalized = normalizeForUsageLabelSearch(stripAnsiCodes(value));
  return usageCaptureHasSessionValue(value) && normalized.includes("currentweek");
}

function extractClaudeUsageWindow(
  lines: ReadonlyArray<string>,
  labels: ReadonlyArray<string>,
  input: {
    readonly id: string;
    readonly label: string;
    readonly windowDurationMins: number | null;
  },
): ClaudeRateLimitProbeWindow | null {
  const normalizedLabels = labels.map(normalizeForUsageLabelSearch);
  const normalizedLines = lines.map(normalizeForUsageLabelSearch);
  const startIndex = normalizedLines.findIndex((line) =>
    normalizedLabels.some((label) => line.includes(label)),
  );
  if (startIndex === -1) {
    return null;
  }

  const windowLines: string[] = [];
  for (const line of lines.slice(startIndex, startIndex + 14)) {
    const normalizedLine = normalizeForUsageLabelSearch(line);
    if (
      windowLines.length > 0 &&
      normalizedLine.startsWith("current") &&
      !normalizedLabels.some((label) => normalizedLine.includes(label))
    ) {
      break;
    }
    windowLines.push(line);
  }

  const windowText = windowLines.join("\n");
  const usedPercent = parseUsagePercent(windowText);
  if (usedPercent === null) {
    return null;
  }

  const resetsAtText = parseUsageResetText(windowText);
  return {
    id: input.id,
    label: input.label,
    usedPercent,
    ...(resetsAtText ? { resetsAtText } : {}),
    windowDurationMins: input.windowDurationMins,
  };
}

export function parseClaudeCliUsageRateLimits(text: string): ClaudeRateLimitProbe | undefined {
  const clean = stripAnsiCodes(text);
  const usagePanelStart = clean.toLowerCase().lastIndexOf("settings:");
  const panel =
    usagePanelStart >= 0 && clean.slice(usagePanelStart).toLowerCase().includes("usage")
      ? clean.slice(usagePanelStart)
      : clean;
  const lines = panel
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const windows = [
    extractClaudeUsageWindow(lines, ["Current session"], {
      id: "five_hour",
      label: "5h",
      windowDurationMins: 300,
    }),
    extractClaudeUsageWindow(lines, ["Current week (all models)"], {
      id: "seven_day",
      label: "weekly",
      windowDurationMins: 10_080,
    }),
    extractClaudeUsageWindow(
      lines,
      ["Current week (Sonnet only)", "Current week (Sonnet)", "Current week (Opus)"],
      {
        id: "seven_day_sonnet",
        label: "weekly sonnet",
        windowDurationMins: 10_080,
      },
    ),
  ].filter((window): window is ClaudeRateLimitProbeWindow => window !== null);

  if (windows.length === 0) {
    return undefined;
  }

  return {
    rateLimits: {
      source: "claude-cli-usage",
      windows,
    },
  };
}

function captureClaudeCliUsage(
  claudeSettings: ClaudeSettings,
  claudeEnvironment: NodeJS.ProcessEnv,
): Effect.Effect<string, ClaudeCliUsageProbeError> {
  let cleanup = noopCleanup;
  let stopped = false;
  return Effect.tryPromise({
    try: () =>
      new Promise<string>((resolve, reject) => {
        let done = false;
        const chunks: string[] = [];

        const finish = (result: string) => {
          if (done) return;
          done = true;
          resolve(result);
        };
        const fail = (cause: unknown) => {
          if (done) return;
          done = true;
          reject(cause);
        };

        void import("node-pty")
          .then((nodePty) => {
            if (stopped) return;
            const spawned = nodePty.spawn(claudeSettings.binaryPath, [], {
              cols: 100,
              rows: 32,
              cwd:
                typeof claudeEnvironment.HOME === "string" && claudeEnvironment.HOME.trim()
                  ? claudeEnvironment.HOME
                  : process.cwd(),
              env: claudeEnvironment,
              name: process.platform === "win32" ? "xterm-color" : "xterm-256color",
            });
            cleanup = () => {
              stopped = true;
              try {
                spawned.kill();
              } catch {
                // Process may already be gone.
              }
            };

            spawned.write("/usage\r\r");

            spawned.onData((chunk) => {
              chunks.push(chunk);
              const output = chunks.join("");
              if (usageCaptureHasWeeklyValue(output)) {
                finish(output);
              }
            });
            spawned.onExit(() => {
              finish(chunks.join(""));
            });
          })
          .catch(fail);
      }),
    catch: (cause) =>
      new ClaudeCliUsageProbeError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  }).pipe(Effect.ensuring(Effect.sync(() => cleanup())));
}

const probeClaudeCliRateLimits = (
  claudeSettings: ClaudeSettings,
  environment: NodeJS.ProcessEnv = process.env,
) =>
  Effect.gen(function* () {
    const claudeEnvironment = yield* makeClaudeEnvironment(claudeSettings, environment);
    const output = yield* captureClaudeCliUsage(claudeSettings, claudeEnvironment);
    return parseClaudeCliUsageRateLimits(output);
  }).pipe(
    Effect.timeoutOption(CLAUDE_USAGE_PROBE_TIMEOUT_MS + 2_000),
    Effect.orElseSucceed(() => Option.none()),
  );

const runClaudeCommand = Effect.fn("runClaudeCommand")(function* (
  claudeSettings: ClaudeSettings,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const claudeEnvironment = yield* makeClaudeEnvironment(claudeSettings, environment);
  const command = ChildProcess.make(claudeSettings.binaryPath, [...args], {
    env: claudeEnvironment,
    shell: process.platform === "win32",
  });
  return yield* spawnAndCollect(claudeSettings.binaryPath, command);
});

export const checkClaudeProviderStatus = Effect.fn("checkClaudeProviderStatus")(function* (
  claudeSettings: ClaudeSettings,
  resolveCapabilities?: (
    claudeSettings: ClaudeSettings,
  ) => Effect.Effect<ClaudeCapabilitiesProbe | undefined>,
  environment: NodeJS.ProcessEnv = process.env,
  resolveRateLimits?: (
    claudeSettings: ClaudeSettings,
  ) => Effect.Effect<Option.Option<ClaudeRateLimitProbe | undefined>, never, Path.Path>,
): Effect.fn.Return<
  ServerProviderDraft,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Path.Path
> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const allModels = providerModelsFromSettings(
    BUILT_IN_MODELS,
    PROVIDER,
    claudeSettings.customModels,
    DEFAULT_CLAUDE_MODEL_CAPABILITIES,
  );

  if (!claudeSettings.enabled) {
    return buildServerProvider({
      presentation: CLAUDE_PRESENTATION,
      enabled: false,
      checkedAt,
      models: allModels,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Claude is disabled in T3 Code settings.",
      },
    });
  }

  const versionProbe = yield* runClaudeCommand(claudeSettings, ["--version"], environment).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionProbe)) {
    const error = versionProbe.failure;
    return buildServerProvider({
      presentation: CLAUDE_PRESENTATION,
      enabled: claudeSettings.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? "Claude Agent CLI (`claude`) is not installed or not on PATH."
          : `Failed to execute Claude Agent CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
      },
    });
  }

  if (Option.isNone(versionProbe.success)) {
    return buildServerProvider({
      presentation: CLAUDE_PRESENTATION,
      enabled: claudeSettings.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message:
          "Claude Agent CLI is installed but failed to run. Timed out while running command.",
      },
    });
  }

  const version = versionProbe.success.value;
  const parsedVersion = parseGenericCliVersion(`${version.stdout}\n${version.stderr}`);
  if (version.code !== 0) {
    const detail = detailFromResult(version);
    return buildServerProvider({
      presentation: CLAUDE_PRESENTATION,
      enabled: claudeSettings.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "error",
        auth: { status: "unknown" },
        message: detail
          ? `Claude Agent CLI is installed but failed to run. ${detail}`
          : "Claude Agent CLI is installed but failed to run.",
      },
    });
  }

  const models = providerModelsFromSettings(
    getBuiltInClaudeModelsForVersion(parsedVersion),
    PROVIDER,
    claudeSettings.customModels,
    DEFAULT_CLAUDE_MODEL_CAPABILITIES,
  );
  const versionUpgradeMessage = supportsClaudeOpus48(parsedVersion)
    ? undefined
    : supportsClaudeOpus47(parsedVersion)
      ? formatClaudeOpus48UpgradeMessage(parsedVersion)
      : formatClaudeOpus47UpgradeMessage(parsedVersion);

  const capabilities = resolveCapabilities
    ? yield* resolveCapabilities(claudeSettings).pipe(Effect.orElseSucceed(() => undefined))
    : undefined;
  const slashCommands = capabilities?.slashCommands ?? [];
  const dedupedSlashCommands = dedupeSlashCommands(slashCommands);

  if (!capabilities) {
    return buildServerProvider({
      presentation: CLAUDE_PRESENTATION,
      enabled: claudeSettings.enabled,
      checkedAt,
      models,
      slashCommands: dedupedSlashCommands,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "warning",
        auth: { status: "unknown" },
        message: "Could not verify Claude authentication status from initialization result.",
      },
    });
  }

  const authMetadata = claudeAuthMetadata({
    subscriptionType: capabilities.subscriptionType,
    authMethod: capabilities.tokenSource,
  });
  const accountRateLimits = resolveRateLimits
    ? yield* resolveRateLimits(claudeSettings).pipe(
        Effect.map((result) => (Option.isSome(result) ? result.value : undefined)),
        Effect.orElseSucceed(() => undefined),
      )
    : undefined;
  return buildServerProvider({
    presentation: CLAUDE_PRESENTATION,
    enabled: claudeSettings.enabled,
    checkedAt,
    models,
    slashCommands: dedupedSlashCommands,
    accountRateLimits,
    probe: {
      installed: true,
      version: parsedVersion,
      status: "ready",
      auth: {
        status: "authenticated",
        ...(capabilities.email ? { email: capabilities.email } : {}),
        ...(authMetadata ? authMetadata : {}),
      },
      ...(versionUpgradeMessage ? { message: versionUpgradeMessage } : {}),
    },
  });
});

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

export const makePendingClaudeProvider = (
  claudeSettings: ClaudeSettings,
): Effect.Effect<ServerProviderDraft> =>
  Effect.gen(function* () {
    const checkedAt = yield* nowIso;
    const models = providerModelsFromSettings(
      BUILT_IN_MODELS,
      PROVIDER,
      claudeSettings.customModels,
      DEFAULT_CLAUDE_MODEL_CAPABILITIES,
    );

    if (!claudeSettings.enabled) {
      return buildServerProvider({
        presentation: CLAUDE_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Claude is disabled in T3 Code settings.",
        },
      });
    }

    return buildServerProvider({
      presentation: CLAUDE_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Claude provider status has not been checked in this session yet.",
      },
    });
  });

export { probeClaudeCapabilities, probeClaudeCliRateLimits };
