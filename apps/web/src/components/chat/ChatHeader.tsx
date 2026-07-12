import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type EditorId,
  type EnvironmentId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, EllipsisVerticalIcon } from "lucide-react";
import { memo, useState } from "react";

import type { DraftId } from "~/composerDraftStore";
import { cn } from "~/lib/utils";
import { usePrimaryEnvironmentId } from "../../state/environments";
import GitActionsControl from "../GitActionsControl";
import { MobileChatActionsSheet } from "../mobile/MobileChatActionsSheet";
import ProjectScriptsControl, {
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
} from "../ProjectScriptsControl";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { OpenInPicker } from "./OpenInPicker";

interface ChatHeaderProps {
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  draftId?: DraftId;
  activeThreadTitle: string;
  activeProjectName: string | undefined;
  openInCwd: string | null;
  activeProjectScripts: ReadonlyArray<ProjectScript> | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  rightPanelOpen: boolean;
  gitCwd: string | null;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  onUpdateProjectScript: (
    scriptId: string,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  onDeleteProjectScript: (scriptId: string) => Promise<ProjectScriptActionResult>;
}

export function shouldShowOpenInPicker(input: {
  readonly activeProjectName: string | undefined;
  readonly activeThreadEnvironmentId: EnvironmentId;
  readonly primaryEnvironmentId: EnvironmentId | null;
}): boolean {
  return (
    Boolean(input.activeProjectName) &&
    input.primaryEnvironmentId !== null &&
    input.activeThreadEnvironmentId === input.primaryEnvironmentId
  );
}

export const ChatHeader = memo(function ChatHeader(props: ChatHeaderProps) {
  const navigate = useNavigate();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const showOpenInPicker = shouldShowOpenInPicker({
    activeProjectName: props.activeProjectName,
    activeThreadEnvironmentId: props.activeThreadEnvironmentId,
    primaryEnvironmentId,
  });
  const tools = (
    <>
      {props.activeProjectScripts ? (
        <ProjectScriptsControl
          scripts={props.activeProjectScripts}
          keybindings={props.keybindings}
          preferredScriptId={props.preferredScriptId}
          onRunScript={props.onRunProjectScript}
          onAddScript={props.onAddProjectScript}
          onUpdateScript={props.onUpdateProjectScript}
          onDeleteScript={props.onDeleteProjectScript}
        />
      ) : null}
      {showOpenInPicker ? (
        <OpenInPicker
          environmentId={props.activeThreadEnvironmentId}
          keybindings={props.keybindings}
          availableEditors={props.availableEditors}
          openInCwd={props.openInCwd}
        />
      ) : null}
      {props.activeProjectName ? (
        <GitActionsControl
          gitCwd={props.gitCwd}
          activeThreadRef={scopeThreadRef(props.activeThreadEnvironmentId, props.activeThreadId)}
          {...(props.draftId ? { draftId: props.draftId } : {})}
        />
      ) : null}
    </>
  );

  return (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:hidden">
        <button
          type="button"
          aria-label="Back to mobile home"
          className="grid size-8 shrink-0 place-items-center rounded-lg border border-border/70 bg-card/70 text-muted-foreground active:bg-accent"
          onClick={() => void navigate({ to: "/" })}
        >
          <ArrowLeftIcon className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{props.activeThreadTitle}</h2>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {props.activeProjectName ?? "No project"}
          </div>
        </div>
        <span className="rounded-md border border-primary/30 bg-primary/12 px-1.5 py-0.5 text-[11px] font-medium text-primary">
          {props.draftId ? "Draft" : "Ready"}
        </span>
        <button
          type="button"
          aria-label="Thread actions"
          className="grid size-8 shrink-0 place-items-center rounded-lg border border-border/70 bg-card/70 text-muted-foreground active:bg-accent"
          onClick={() => setMobileActionsOpen(true)}
        >
          <EllipsisVerticalIcon className="size-4" />
        </button>
        <MobileChatActionsSheet
          open={mobileActionsOpen}
          onClose={() => setMobileActionsOpen(false)}
          title={props.activeThreadTitle}
          subtitle={props.activeProjectName}
          onReviewDiff={() => undefined}
          reviewDisabled
          onCommandLogs={() => undefined}
          commandLogsDisabled
          tools={tools}
        />
      </div>

      <div className="@container/header-actions hidden min-w-0 flex-1 items-center gap-2 sm:flex sm:gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
          <Tooltip>
            <TooltipTrigger
              render={
                <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {props.activeThreadTitle}
                </h2>
              }
            />
            <TooltipPopup side="top">{props.activeThreadTitle}</TooltipPopup>
          </Tooltip>
        </div>
        <div
          data-chat-header-actions
          className={cn(
            "flex shrink-0 items-center justify-end gap-2 @3xl/header-actions:gap-3",
            props.rightPanelOpen ? "pr-0" : "pr-16",
          )}
        >
          {tools}
        </div>
      </div>
    </>
  );
});
