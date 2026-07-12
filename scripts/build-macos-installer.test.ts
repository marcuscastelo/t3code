import { assert, describe, it } from "@effect/vitest";

import {
  compareReleaseVersions,
  parseMacosInstallerArgs,
  releaseVersionFromStableTag,
  resolveAutomaticMacosInstallerVersion,
} from "./build-macos-installer.ts";

describe("build-macos-installer", () => {
  it("sorts release versions numerically", () => {
    assert.ok(compareReleaseVersions("0.0.27", "0.0.28") < 0);
    assert.ok(compareReleaseVersions("0.0.28", "0.0.27") > 0);
    assert.ok(compareReleaseVersions("0.10.0", "0.9.9") > 0);
  });

  it("reads only stable release versions from tags", () => {
    assert.equal(releaseVersionFromStableTag("v0.0.27"), "0.0.27");
    assert.equal(releaseVersionFromStableTag("v0.0.28-nightly.20260612.535"), undefined);
  });

  it("uses the highest stable version from release package versions and git tags", () => {
    assert.equal(
      resolveAutomaticMacosInstallerVersion({
        packageVersions: ["0.0.25", "0.0.25", "0.0.25", "0.0.25"],
        stableTags: ["v0.0.26", "v0.0.27", "v0.0.28-nightly.20260612.535"],
      }),
      "0.0.27",
    );
  });

  it("uses package versions when they are ahead of stable git tags", () => {
    assert.equal(
      resolveAutomaticMacosInstallerVersion({
        packageVersions: ["0.0.28", "0.0.28", "0.0.28", "0.0.28"],
        stableTags: ["v0.0.27"],
      }),
      "0.0.28",
    );
  });

  it("extracts explicit versions without forwarding them to the artifact builder", () => {
    assert.deepStrictEqual(
      parseMacosInstallerArgs(["--", "--arch", "arm64", "--version", "0.0.27", "--skip-build"]),
      {
        explicitVersion: "0.0.27",
        passThroughArgs: ["--arch", "arm64", "--skip-build"],
      },
    );

    assert.deepStrictEqual(parseMacosInstallerArgs(["--build-version=0.0.28"]), {
      explicitVersion: "0.0.28",
      passThroughArgs: [],
    });
  });
});
