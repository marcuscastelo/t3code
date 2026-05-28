import { DiffIcon, TerminalSquareIcon, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Sheet, SheetPopup } from "../ui/sheet";

export function MobileChatActionsSheet(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string | undefined;
  onReviewDiff: () => void;
  reviewDisabled: boolean;
  onCommandLogs: () => void;
  commandLogsDisabled: boolean;
  /** Real toolbar controls (git actions, open-in-editor, project scripts). */
  tools?: ReactNode;
}) {
  return (
    <Sheet
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          props.onClose();
        }
      }}
    >
      <SheetPopup
        side="bottom"
        showCloseButton
        className="max-h-[80svh] rounded-t-3xl bg-popover p-0"
      >
        <div className="flex min-h-0 flex-col overflow-y-auto px-5 pt-2 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <div className="mx-auto mb-3 h-1 w-9 shrink-0 rounded-full bg-border" />
          <h2 className="truncate text-base font-bold tracking-tight">{props.title}</h2>
          {props.subtitle ? (
            <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
              {props.subtitle}
            </p>
          ) : null}

          <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-card/60">
            <ActionRow
              icon={DiffIcon}
              label="Review changed files"
              sub="Open the diff panel"
              disabled={props.reviewDisabled}
              onClick={() => {
                props.onReviewDiff();
                props.onClose();
              }}
            />
            <ActionRow
              icon={TerminalSquareIcon}
              label="Command logs"
              sub="Open the terminal drawer"
              disabled={props.commandLogsDisabled}
              border
              onClick={() => {
                props.onCommandLogs();
                props.onClose();
              }}
            />
          </div>

          {props.tools ? (
            <>
              <div className="mt-4 mb-2 px-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Repository
              </div>
              <div className="flex flex-wrap items-center gap-2">{props.tools}</div>
            </>
          ) : null}
        </div>
      </SheetPopup>
    </Sheet>
  );
}

function ActionRow(props: {
  icon: LucideIcon;
  label: string;
  sub: string;
  disabled?: boolean;
  border?: boolean;
  onClick: () => void;
}) {
  const Icon = props.icon;
  return (
    <button
      type="button"
      disabled={props.disabled}
      className={`flex w-full items-center gap-3 px-3.5 py-3 text-left active:bg-accent disabled:opacity-50 ${
        props.border ? "border-t border-border/50" : ""
      }`}
      onClick={props.onClick}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{props.label}</span>
        <span className="block text-[11px] text-muted-foreground">{props.sub}</span>
      </span>
    </button>
  );
}
