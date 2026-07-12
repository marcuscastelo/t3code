import {
  BriefcaseBusinessIcon,
  CheckIcon,
  Layers3Icon,
  PlusIcon,
  SettingsIcon,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { ProjectContextId, type ProjectContext } from "@t3tools/contracts/settings";
import { cn } from "../lib/utils";
import type { ProjectContextSummary } from "../projectContexts";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "./ui/menu";

const ALL_CONTEXT_VALUE = "all";
const CONTEXT_VALUE_PREFIX = "context:";

interface ProjectContextSwitcherProps {
  contexts: readonly ProjectContext[];
  summaries: readonly ProjectContextSummary[];
  activeContextId: ProjectContextId | null;
  className?: string;
  variant?: "desktop" | "mobile";
  onSelectContext: (contextId: ProjectContextId | null) => void;
  onCreateContext: (name: string) => void;
  onManageContexts?: () => void;
}

function contextValue(contextId: ProjectContextId | null): string {
  return contextId ? `${CONTEXT_VALUE_PREFIX}${contextId}` : ALL_CONTEXT_VALUE;
}

function contextIdFromValue(value: string): ProjectContextId | null {
  return value.startsWith(CONTEXT_VALUE_PREFIX)
    ? ProjectContextId.make(value.slice(CONTEXT_VALUE_PREFIX.length))
    : null;
}

function formatCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function summaryLabel(summary: ProjectContextSummary | null | undefined): string {
  if (!summary) {
    return "0 projects";
  }
  const projectText = formatCount(summary.projectCount, "project", "projects");
  if (summary.threadCount === 0) {
    return projectText;
  }
  return `${projectText} · ${formatCount(summary.threadCount, "thread", "threads")}`;
}

export function ProjectContextSwitcher({
  contexts,
  summaries,
  activeContextId,
  className,
  variant = "desktop",
  onSelectContext,
  onCreateContext,
  onManageContexts,
}: ProjectContextSwitcherProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [contextName, setContextName] = useState("");
  const summaryByContextId = useMemo(
    () => new Map(summaries.map((summary) => [summary.contextId ?? null, summary] as const)),
    [summaries],
  );
  const activeContext = activeContextId
    ? contexts.find((context) => context.id === activeContextId)
    : null;
  const activeLabel = activeContext?.name ?? "All contexts";
  const activeSummary = summaryByContextId.get(activeContextId ?? null);
  const triggerClassName =
    variant === "mobile"
      ? "h-9 w-full rounded-lg border border-border/70 bg-card/70 px-3 text-sm"
      : "h-8 w-full rounded-lg border border-sidebar-border/70 bg-sidebar-accent/35 px-2 text-xs";

  const openCreateDialog = useCallback(() => {
    setContextName("");
    setCreateDialogOpen(true);
  }, []);
  const closeCreateDialog = useCallback(() => {
    setCreateDialogOpen(false);
    setContextName("");
  }, []);
  const submitCreateContext = useCallback(() => {
    const trimmed = contextName.trim();
    if (!trimmed) {
      return;
    }
    onCreateContext(trimmed);
    closeCreateDialog();
  }, [closeCreateDialog, contextName, onCreateContext]);

  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <button
              type="button"
              aria-label="Project context"
              className={cn(
                "inline-flex min-w-0 cursor-pointer items-center gap-2 text-left outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                triggerClassName,
                className,
              )}
            />
          }
        >
          <Layers3Icon className="size-3.5 shrink-0 text-muted-foreground/70" />
          <span className="min-w-0 flex-1 truncate font-medium">{activeLabel}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground/60">
            {activeSummary?.projectCount ?? 0}
          </span>
        </MenuTrigger>
        <MenuPopup align="start" className="min-w-64">
          <MenuGroup>
            <div className="px-2 py-1 text-xs font-medium text-muted-foreground">Context</div>
            <MenuRadioGroup
              value={contextValue(activeContextId)}
              onValueChange={(value) => onSelectContext(contextIdFromValue(value))}
            >
              <MenuRadioItem value={ALL_CONTEXT_VALUE}>
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <Layers3Icon className="size-3.5 shrink-0 opacity-70" />
                  <span className="min-w-0 flex-1 truncate">All contexts</span>
                  <span className="shrink-0 text-xs text-muted-foreground/60">
                    {summaryLabel(summaryByContextId.get(null))}
                  </span>
                </span>
              </MenuRadioItem>
              {contexts.map((context) => (
                <MenuRadioItem key={context.id} value={contextValue(context.id)}>
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <BriefcaseBusinessIcon className="size-3.5 shrink-0 opacity-70" />
                    <span className="min-w-0 flex-1 truncate">{context.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground/60">
                      {summaryLabel(summaryByContextId.get(context.id))}
                    </span>
                  </span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuGroup>
          <MenuSeparator />
          {onManageContexts ? (
            <>
              <MenuItem onClick={onManageContexts}>
                <SettingsIcon className="size-4" />
                Manage workspaces
              </MenuItem>
              <MenuSeparator />
            </>
          ) : null}
          <MenuItem onClick={openCreateDialog}>
            <PlusIcon className="size-4" />
            New context
          </MenuItem>
        </MenuPopup>
      </Menu>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>New context</DialogTitle>
            <DialogDescription>
              Create a context for a company, group, or area of work.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <label className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted-foreground">Name</span>
              <Input
                autoFocus
                value={contextName}
                placeholder="Startup"
                onChange={(event) => setContextName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitCreateContext();
                  }
                }}
              />
            </label>
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" onClick={closeCreateDialog}>
              Cancel
            </Button>
            <Button disabled={contextName.trim().length === 0} onClick={submitCreateContext}>
              <CheckIcon className="size-4" />
              Create
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
