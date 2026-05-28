import {
  type EnvironmentId,
  type EditorId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime";
import { useNavigate } from "@tanstack/react-router";
import { memo, useState } from "react";
import GitActionsControl from "../GitActionsControl";
import { type DraftId } from "~/composerDraftStore";
import { ArrowLeftIcon, DiffIcon, EllipsisVerticalIcon, TerminalSquareIcon } from "lucide-react";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ProjectScriptsControl, { type NewProjectScriptInput } from "../ProjectScriptsControl";
import { Toggle } from "../ui/toggle";
import { SidebarTrigger } from "../ui/sidebar";
import { OpenInPicker } from "./OpenInPicker";
import { MobileChatActionsSheet } from "../mobile/MobileChatActionsSheet";
import { usePrimaryEnvironmentId } from "../../environments/primary";

interface ChatHeaderProps {
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  draftId?: DraftId;
  activeThreadTitle: string;
  activeProjectName: string | undefined;
  isGitRepo: boolean;
  openInCwd: string | null;
  activeProjectScripts: ProjectScript[] | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  terminalToggleShortcutLabel: string | null;
  diffToggleShortcutLabel: string | null;
  gitCwd: string | null;
  diffOpen: boolean;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  onDeleteProjectScript: (scriptId: string) => Promise<void>;
  onToggleTerminal: () => void;
  onToggleDiff: () => void;
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

export const ChatHeader = memo(function ChatHeader({
  activeThreadEnvironmentId,
  activeThreadId,
  draftId,
  activeThreadTitle,
  activeProjectName,
  isGitRepo,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  terminalAvailable,
  terminalOpen,
  terminalToggleShortcutLabel,
  diffToggleShortcutLabel,
  gitCwd,
  diffOpen,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onToggleTerminal,
  onToggleDiff,
}: ChatHeaderProps) {
  const navigate = useNavigate();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const showOpenInPicker = shouldShowOpenInPicker({
    activeProjectName,
    activeThreadEnvironmentId,
    primaryEnvironmentId,
  });
  const mobileThreadStateLabel = draftId ? "Draft" : terminalOpen ? "Running" : "Ready";

  // The git / open-in-editor / project-script controls are hidden on the
  // desktop header below `sm`; surface them on mobile through the actions sheet.
  const hasRepoTools =
    Boolean(activeProjectScripts) || showOpenInPicker || Boolean(activeProjectName);
  const repoTools = hasRepoTools ? (
    <>
      {activeProjectScripts && (
        <ProjectScriptsControl
          scripts={activeProjectScripts}
          keybindings={keybindings}
          preferredScriptId={preferredScriptId}
          onRunScript={onRunProjectScript}
          onAddScript={onAddProjectScript}
          onUpdateScript={onUpdateProjectScript}
          onDeleteScript={onDeleteProjectScript}
        />
      )}
      {showOpenInPicker && (
        <OpenInPicker
          keybindings={keybindings}
          availableEditors={availableEditors}
          openInCwd={openInCwd}
        />
      )}
      {activeProjectName && (
        <GitActionsControl
          gitCwd={gitCwd}
          activeThreadRef={scopeThreadRef(activeThreadEnvironmentId, activeThreadId)}
          {...(draftId ? { draftId } : {})}
        />
      )}
    </>
  ) : undefined;

  return (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:hidden">
        <button
          type="button"
          className="grid size-8 shrink-0 place-items-center rounded-lg border border-border/70 bg-card/70 text-muted-foreground active:bg-accent active:text-foreground"
          aria-label="Back to mobile home"
          onClick={() => void navigate({ to: "/" })}
        >
          <ArrowLeftIcon className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold leading-5" title={activeThreadTitle}>
            {activeThreadTitle}
          </h2>
          <div className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            <span className="truncate">{activeProjectName ?? "No project"}</span>
            {activeProjectName && !isGitRepo ? <span className="shrink-0">· no git</span> : null}
          </div>
        </div>
        <span className="shrink-0 rounded-md border border-primary/30 bg-primary/12 px-1.5 py-0.5 text-[11px] font-medium text-primary">
          {mobileThreadStateLabel}
        </span>
        <button
          type="button"
          aria-label="Thread actions"
          className="grid size-8 shrink-0 place-items-center rounded-lg border border-border/70 bg-card/70 text-muted-foreground active:bg-accent active:text-foreground"
          onClick={() => setMobileActionsOpen(true)}
        >
          <EllipsisVerticalIcon className="size-4" />
        </button>
        <MobileChatActionsSheet
          open={mobileActionsOpen}
          onClose={() => setMobileActionsOpen(false)}
          title={activeThreadTitle}
          subtitle={
            activeProjectName ? `${activeProjectName}${isGitRepo ? "" : " · no git"}` : undefined
          }
          onReviewDiff={() => {
            if (!diffOpen) {
              onToggleDiff();
            }
          }}
          reviewDisabled={!isGitRepo && !diffOpen}
          onCommandLogs={() => {
            if (!terminalOpen) {
              onToggleTerminal();
            }
          }}
          commandLogsDisabled={!terminalAvailable}
          tools={repoTools}
        />
      </div>

      <div className="@container/header-actions hidden min-w-0 flex-1 items-center gap-2 sm:flex">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
          <SidebarTrigger className="size-7 shrink-0 md:hidden" />
          <h2
            className="min-w-0 shrink truncate text-sm font-medium text-foreground"
            title={activeThreadTitle}
          >
            {activeThreadTitle}
          </h2>
          {activeProjectName && (
            <Badge variant="outline" className="min-w-0 shrink overflow-hidden">
              <span className="min-w-0 truncate">{activeProjectName}</span>
            </Badge>
          )}
          {activeProjectName && !isGitRepo && (
            <Badge variant="outline" className="shrink-0 text-[10px] text-amber-700">
              No Git
            </Badge>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 @3xl/header-actions:gap-3">
          {activeProjectScripts && (
            <ProjectScriptsControl
              scripts={activeProjectScripts}
              keybindings={keybindings}
              preferredScriptId={preferredScriptId}
              onRunScript={onRunProjectScript}
              onAddScript={onAddProjectScript}
              onUpdateScript={onUpdateProjectScript}
              onDeleteScript={onDeleteProjectScript}
            />
          )}
          {showOpenInPicker && (
            <OpenInPicker
              keybindings={keybindings}
              availableEditors={availableEditors}
              openInCwd={openInCwd}
            />
          )}
          {activeProjectName && (
            <GitActionsControl
              gitCwd={gitCwd}
              activeThreadRef={scopeThreadRef(activeThreadEnvironmentId, activeThreadId)}
              {...(draftId ? { draftId } : {})}
            />
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  className="shrink-0"
                  pressed={terminalOpen}
                  onPressedChange={onToggleTerminal}
                  aria-label="Toggle terminal drawer"
                  variant="outline"
                  size="xs"
                  disabled={!terminalAvailable}
                >
                  <TerminalSquareIcon className="size-3" />
                </Toggle>
              }
            />
            <TooltipPopup side="bottom">
              {!terminalAvailable
                ? "Terminal is unavailable until this thread has an active project."
                : terminalToggleShortcutLabel
                  ? `Toggle terminal drawer (${terminalToggleShortcutLabel})`
                  : "Toggle terminal drawer"}
            </TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  className="shrink-0"
                  pressed={diffOpen}
                  onPressedChange={onToggleDiff}
                  aria-label="Toggle diff panel"
                  variant="outline"
                  size="xs"
                  disabled={!isGitRepo && !diffOpen}
                >
                  <DiffIcon className="size-3" />
                </Toggle>
              }
            />
            <TooltipPopup side="bottom">
              {!isGitRepo && !diffOpen
                ? "Diff panel is unavailable because this project is not a git repository."
                : diffToggleShortcutLabel
                  ? `Toggle diff panel (${diffToggleShortcutLabel})`
                  : "Toggle diff panel"}
            </TooltipPopup>
          </Tooltip>
        </div>
      </div>
    </>
  );
});
