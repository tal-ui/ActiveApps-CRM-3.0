import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Banknote,
  CalendarRange,
  Calculator,
  Kanban,
  LayoutDashboard,
  LayoutPanelLeft,
  LogOut,
  Menu,
  ScrollText,
  Search,
  Settings2,
  Slack,
  SlidersHorizontal,
  Users,
  Webhook,
  Wrench,
} from "lucide-react";
import { NAV_OBJECTS, OBJECTS } from "../lib/objects";
import { useAuth } from "../lib/auth";
import TimerWidget from "./TimerWidget";
import ThemeToggle from "./ThemeToggle";
import CommandPalette from "./CommandPalette";

export default function Layout() {
  const { profile, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Close mobile drawer on Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Lock body scroll while the mobile drawer is open
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, [drawerOpen]);

  // Close the drawer when the viewport grows past the lg breakpoint (e.g.
  // tablet rotation) so the scroll lock and overlay can't outlive it.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 64rem)");
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setDrawerOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const navItemClass = ({ isActive }: { isActive: boolean }) =>
    isActive
      ? "flex items-center gap-3 px-3 py-2 bg-[rgba(60,201,152,0.08)] border-l-2 border-[var(--mint)] rounded-r-[var(--radius-sm)] text-[var(--mint)] text-sm font-medium cursor-pointer"
      : "flex items-center gap-3 px-3 py-2 border-l-2 border-transparent text-[var(--text-dim)] text-sm cursor-pointer transition-colors duration-200 hover:text-[var(--foreground)] hover:bg-[var(--navy-surface)] rounded-[var(--radius-sm)]";

  return (
    <div className="min-h-screen">
      {/* Sidebar — off-canvas drawer on mobile, always visible at lg+ */}
      <aside
        className={`w-60 bg-[var(--navy)] border-r border-[var(--sidebar-border)] h-screen fixed flex flex-col z-50 transition-[transform,visibility] duration-300 lg:translate-x-0 ${
          drawerOpen ? "translate-x-0" : "-translate-x-full max-lg:invisible"
        }`}
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingLeft: "env(safe-area-inset-left)",
        }}
      >
        <div className="p-5 flex-1 overflow-y-auto">
          <div className="flex items-center gap-2.5 mb-1">
            <img src="/aa-logo.png" alt="ActiveApps" className="w-7 h-7 rounded" />
            <div>
              <span className="font-[var(--font-heading)] font-bold text-[var(--text-light)]">
                ACTIVE
              </span>
              <span className="font-[var(--font-heading)] font-bold text-[var(--mint)]">
                APPS
              </span>
            </div>
          </div>
          <p className="label-mono text-[var(--text-muted)] mb-7 ml-[38px]">CRM 3.0</p>

          <nav className="space-y-1" onClick={() => setDrawerOpen(false)}>
            <NavLink to="/" end className={navItemClass}>
              <LayoutDashboard size={16} strokeWidth={1.5} />
              Dashboard
            </NavLink>
            <NavLink to="/pipeline" className={navItemClass}>
              <Kanban size={16} strokeWidth={1.5} />
              Pipeline
            </NavLink>
            <NavLink to="/financial" className={navItemClass}>
              <Banknote size={16} strokeWidth={1.5} />
              Financial
            </NavLink>
            <NavLink to="/monthly" className={navItemClass}>
              <CalendarRange size={16} strokeWidth={1.5} />
              Monthly Ops
            </NavLink>
            <NavLink to="/currency" className={navItemClass}>
              <Calculator size={16} strokeWidth={1.5} />
              Currency
            </NavLink>
            {NAV_OBJECTS.map((name) => {
              const def = OBJECTS[name];
              const Icon = def.icon;
              return (
                <NavLink key={name} to={`/${name}`} className={navItemClass}>
                  <Icon size={16} strokeWidth={1.5} />
                  {def.plural}
                </NavLink>
              );
            })}

            <p className="label-mono !text-[var(--text-muted)] pt-5 pb-1 px-3">
              Settings &amp; Setup
            </p>
            <NavLink to="/settings/custom-fields" className={navItemClass}>
              <SlidersHorizontal size={16} strokeWidth={1.5} />
              Custom Fields
            </NavLink>
            <NavLink to="/settings/layouts" className={navItemClass}>
              <LayoutPanelLeft size={16} strokeWidth={1.5} />
              Page Layouts
            </NavLink>
            <NavLink to="/settings/slack" className={navItemClass}>
              <Slack size={16} strokeWidth={1.5} />
              Slack
            </NavLink>

            {isAdmin && (
              <>
                <NavLink to="/settings/maintenance" className={navItemClass}>
                  <Wrench size={16} strokeWidth={1.5} />
                  Maintenance
                </NavLink>
                <NavLink to="/settings/users" className={navItemClass}>
                  <Users size={16} strokeWidth={1.5} />
                  Users & Roles
                </NavLink>
                <NavLink to="/settings/audit" className={navItemClass}>
                  <ScrollText size={16} strokeWidth={1.5} />
                  Audit Log
                </NavLink>
                <NavLink to="/settings/workspace" className={navItemClass}>
                  <Settings2 size={16} strokeWidth={1.5} />
                  Workspace
                </NavLink>
                <NavLink to="/settings/automations" className={navItemClass}>
                  <Webhook size={16} strokeWidth={1.5} />
                  Automations
                </NavLink>
              </>
            )}
          </nav>
        </div>

        {/* User footer */}
        <div
          className="p-4 border-t border-[var(--hairline)]"
          style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm text-[var(--text-light)] truncate">
                {profile?.full_name || "—"}
              </p>
              <p className="text-xs text-[var(--text-faint)] truncate">
                {profile?.email}
              </p>
            </div>
            <button
              onClick={async () => {
                await signOut();
                navigate("/login");
              }}
              className="text-[var(--text-dim)] hover:text-[var(--mint)] cursor-pointer transition-colors p-1.5"
              title="Sign out"
            >
              <LogOut size={16} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile drawer overlay */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onMouseDown={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Main */}
      <main
        className="lg:ml-60 min-h-screen"
        style={{
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
        }}
      >
        {/* Sticky header with global timer */}
        <header
          className="sticky top-0 z-30 backdrop-blur-xl bg-[var(--header-bg)] border-b border-[var(--sidebar-border)]"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => setDrawerOpen(true)}
                title="Open menu"
                aria-label="Open navigation menu"
                className="lg:hidden flex items-center justify-center h-10 w-10 shrink-0 rounded-[var(--radius-md)] border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--mint)] hover:bg-[var(--navy-surface)] cursor-pointer transition-colors"
              >
                <Menu size={16} strokeWidth={1.5} />
              </button>
              <span className="label-mono">
                <span className="hidden md:inline">
                  {new Date().toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                </span>
                <span className="md:hidden">
                  {new Date().toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </span>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                onClick={() => setPaletteOpen(true)}
                title="Search (Ctrl/⌘K)"
                aria-label="Open command palette"
                className="flex items-center gap-2 h-9 px-3 rounded-[var(--radius-md)] border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--mint)] hover:bg-[var(--navy-surface)] cursor-pointer transition-colors"
              >
                <Search size={15} strokeWidth={1.5} />
                <span className="label-mono !text-inherit hidden md:inline">⌘K</span>
              </button>
              <TimerWidget />
              <ThemeToggle />
            </div>
          </div>
        </header>
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Outlet />
        </div>
      </main>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
