import { createFileRoute } from "@tanstack/react-router";
import { ProjectContextsSettingsPanel } from "../components/settings/ProjectContextsSettings";

export const Route = createFileRoute("/settings/workspaces")({
  component: ProjectContextsSettingsPanel,
});
