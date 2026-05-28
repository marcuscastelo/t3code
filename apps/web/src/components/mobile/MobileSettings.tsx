import { useNavigate } from "@tanstack/react-router";
import {
  ChevronRightIcon,
  CpuIcon,
  GitBranchIcon,
  KeyboardIcon,
  Link2Icon,
  PaletteIcon,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { APP_BASE_NAME, APP_STAGE_LABEL, APP_VERSION } from "../../branding";
import { useTheme } from "../../hooks/useTheme";

interface SettingsLink {
  icon: LucideIcon;
  title: string;
  sub: string;
  to: string;
}

const SETTINGS_LINKS: SettingsLink[] = [
  {
    icon: CpuIcon,
    title: "Providers & models",
    sub: "Default provider, models, effort",
    to: "/settings/providers",
  },
  {
    icon: GitBranchIcon,
    title: "Source control",
    sub: "Git, worktrees, sync",
    to: "/settings/source-control",
  },
  {
    icon: Link2Icon,
    title: "Connections",
    sub: "GitHub & linked accounts",
    to: "/settings/connections",
  },
  {
    icon: KeyboardIcon,
    title: "Keybindings",
    sub: "Shortcuts",
    to: "/settings/keybindings",
  },
];

export function MobileSettings() {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex flex-col gap-6 pb-6">
      <h1 className="px-0.5 text-2xl font-bold tracking-tight">Settings</h1>

      <Section title="Appearance">
        <div className="flex items-center gap-3 px-3.5 py-3">
          <ListIcon icon={PaletteIcon} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Theme</div>
            <div className="text-[11px] text-muted-foreground">Mobile uses a dark palette</div>
          </div>
          <div className="flex gap-0.5 rounded-lg border border-border/70 bg-card/60 p-0.5">
            <SegButton active={theme === "dark"} label="Dark" onClick={() => setTheme("dark")} />
            <SegButton
              active={theme === "system"}
              label="System"
              onClick={() => setTheme("system")}
            />
          </div>
        </div>
      </Section>

      <Section title="Configuration">
        {SETTINGS_LINKS.map((link, index) => {
          const Icon = link.icon;
          return (
            <button
              key={link.to}
              type="button"
              className={`flex w-full items-center gap-3 px-3.5 py-3 text-left active:bg-accent ${
                index > 0 ? "border-t border-border/50" : ""
              }`}
              onClick={() => void navigate({ to: link.to })}
            >
              <ListIcon icon={Icon} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{link.title}</div>
                <div className="text-[11px] text-muted-foreground">{link.sub}</div>
              </div>
              <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
            </button>
          );
        })}
      </Section>

      <div className="text-center font-mono text-[11px] text-muted-foreground/70">
        {APP_BASE_NAME} · v{APP_VERSION} ({APP_STAGE_LABEL.toLowerCase()})
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="px-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <div className="overflow-hidden rounded-xl border border-border/70 bg-card/60">
        {children}
      </div>
    </section>
  );
}

function ListIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
      <Icon className="size-4" />
    </span>
  );
}

function SegButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
        active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
