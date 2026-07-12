#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { releasePackageFiles } from "./update-release-package-versions.ts";

const repoRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const releaseVersionPattern = /^(\d+)\.(\d+)\.(\d+)$/;
const stableReleaseTagPattern = /^v(\d+\.\d+\.\d+)$/;

export interface ParsedMacosInstallerArgs {
  readonly explicitVersion: string | undefined;
  readonly passThroughArgs: ReadonlyArray<string>;
}

export interface MacosInstallerVersionInput {
  readonly packageVersions: ReadonlyArray<string>;
  readonly stableTags: ReadonlyArray<string>;
}

interface VersionParts {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

function parseVersionParts(version: string): VersionParts | undefined {
  const match = releaseVersionPattern.exec(version);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function compareReleaseVersions(a: string, b: string): number {
  const aParts = parseVersionParts(a);
  const bParts = parseVersionParts(b);
  if (!aParts || !bParts) {
    return a.localeCompare(b);
  }

  return aParts.major - bParts.major || aParts.minor - bParts.minor || aParts.patch - bParts.patch;
}

export function releaseVersionFromStableTag(tag: string): string | undefined {
  return stableReleaseTagPattern.exec(tag)?.[1];
}

export function resolveAutomaticMacosInstallerVersion(input: MacosInstallerVersionInput): string {
  const candidates = [
    ...input.packageVersions.filter((version) => parseVersionParts(version)),
    ...input.stableTags.flatMap((tag) => {
      const version = releaseVersionFromStableTag(tag);
      return version ? [version] : [];
    }),
  ];

  if (candidates.length === 0) {
    throw new Error("Could not resolve a release version from package.json files or git tags.");
  }

  return candidates.sort(compareReleaseVersions)[candidates.length - 1]!;
}

export function parseMacosInstallerArgs(args: ReadonlyArray<string>): ParsedMacosInstallerArgs {
  const passThroughArgs: Array<string> = [];
  let explicitVersion: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (arg === "--") continue;
    if (arg === "--version" || arg === "--build-version") {
      const nextValue = args[index + 1];
      if (!nextValue) {
        throw new Error(`${arg} requires a version value.`);
      }
      explicitVersion = nextValue;
      index += 1;
      continue;
    }

    const versionPrefix = arg.startsWith("--version=")
      ? "--version="
      : arg.startsWith("--build-version=")
        ? "--build-version="
        : undefined;
    if (versionPrefix) {
      explicitVersion = arg.slice(versionPrefix.length);
      if (!explicitVersion) {
        throw new Error(`${versionPrefix.slice(0, -1)} requires a version value.`);
      }
      continue;
    }

    passThroughArgs.push(arg);
  }

  return { explicitVersion, passThroughArgs };
}

function readReleasePackageVersions(): ReadonlyArray<string> {
  return releasePackageFiles.map((relativePath) => {
    const packageJson = JSON.parse(
      NodeFS.readFileSync(NodePath.resolve(repoRoot, relativePath), "utf8"),
    ) as {
      readonly version?: unknown;
    };
    if (typeof packageJson.version !== "string") {
      throw new Error(`${relativePath} is missing a string version.`);
    }
    return packageJson.version;
  });
}

function readMergedStableTags(): ReadonlyArray<string> {
  const stdout = NodeChildProcess.execFileSync(
    "git",
    ["tag", "--merged", "HEAD", "--list", "v[0-9]*"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  return stdout
    .split("\n")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0 && releaseVersionFromStableTag(tag) !== undefined);
}

function run() {
  const { explicitVersion, passThroughArgs } = parseMacosInstallerArgs(process.argv.slice(2));
  const version =
    explicitVersion ??
    resolveAutomaticMacosInstallerVersion({
      packageVersions: readReleasePackageVersions(),
      stableTags: readMergedStableTags(),
    });

  const result = NodeChildProcess.spawnSync(
    process.execPath,
    [
      "scripts/build-desktop-artifact.ts",
      "--platform",
      "mac",
      "--target",
      "dmg",
      "--build-version",
      version,
      ...passThroughArgs,
    ],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        APP_VERSION: version,
        T3CODE_DESKTOP_VERSION: version,
      },
    },
  );

  if (result.error) {
    throw result.error;
  }

  process.exit(result.status ?? 1);
}

if (import.meta.main) {
  run();
}
