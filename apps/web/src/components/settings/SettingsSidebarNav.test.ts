import { describe, expect, it } from "vite-plus/test";

import { SETTINGS_NAV_ITEMS } from "./SettingsSidebarNav";

describe("SettingsSidebarNav", () => {
  it("exposes Appearance in the settings navigation", () => {
    expect(
      SETTINGS_NAV_ITEMS.map(({ label, to }) => ({
        label,
        to,
      })),
    ).toContainEqual({
      label: "Appearance",
      to: "/settings/appearance",
    });
  });
});
