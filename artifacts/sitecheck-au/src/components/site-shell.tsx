import type { ReactNode } from 'react';
import { Activity, BookOpen, ClipboardCheck, CreditCard, HardHat, LayoutDashboard, LogOut, Plus, Search, ShieldCheck } from 'lucide-react';
import { useAuth, useClerk } from '@clerk/react';
import { Link, useLocation } from 'wouter';
import { getHealthCheckQueryKey, useHealthCheck } from '@workspace/api-client-react';

const navItems = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/inspections', label: 'Inspections', icon: ClipboardCheck },
  { href: '/standards', label: 'Standards library', icon: BookOpen },
  { href: '/client-language-glossary', label: 'Client language', icon: BookOpen, managerOnly: true },
  { href: '/pricing', label: 'Plans & pricing', icon: CreditCard },
];
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function SiteShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { signOut } = useClerk();
  const { sessionClaims } = useAuth();
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role;
  const isWorkspaceManager = role === 'manager' || role === 'admin';
  const visibleNavItems = navItems.filter((item) => !item.managerOnly || isWorkspaceManager);
  const health = useHealthCheck({ query: { staleTime: 60000, queryKey: getHealthCheckQueryKey() } });
  return (
    <div className="min-h-[100dvh] bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex h-[78px] items-center gap-3 border-b border-sidebar-border px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <HardHat size={20} strokeWidth={2.5} />
          </div>
          <div>
            <div className="font-semibold tracking-tight">SiteCheck <span className="text-sidebar-primary">AU</span></div>
            <div className="font-mono text-[10px] uppercase tracking-[.17em] text-sidebar-foreground/50">field workbench</div>
          </div>
        </div>
        <div className="flex-1 px-3 py-7">
          <div className="mb-3 px-3 font-mono text-[10px] uppercase tracking-[.17em] text-sidebar-foreground/40">Workspace</div>
          <nav className="space-y-1">
             {visibleNavItems.map(({ href, label, icon: Icon }) => {
              const active = href === '/' ? location === '/' : location.startsWith(href);
              return (
                <Link key={href} href={href} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}
                  className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors ${active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'}`}>
                  <Icon size={17} strokeWidth={active ? 2.2 : 1.8} />
                  <span>{label}</span>
                  {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-sidebar-primary" />}
                </Link>
              );
            })}
          </nav>
          <div className="mt-9 rounded-md border border-sidebar-border bg-sidebar-accent/40 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium"><ShieldCheck size={14} className="text-sidebar-primary" /> Standards context</div>
            <p className="text-[11px] leading-relaxed text-sidebar-foreground/50">Record what was observed, then anchor it to the requirement.</p>
            <Link href="/standards" data-testid="link-sidebar-standards" className="mt-3 inline-flex text-[11px] font-semibold text-sidebar-primary hover:underline">Browse references →</Link>
          </div>
        </div>
        <div className="border-t border-sidebar-border px-6 py-4">
          <div className="flex items-center gap-2 text-[11px] text-sidebar-foreground/45">
            <span className={`status-dot ${health.isError ? 'bg-destructive' : health.isLoading ? 'animate-pulse-line bg-accent' : 'bg-sidebar-primary'}`} />
            {health.isError ? 'Service unavailable' : health.isLoading ? 'Checking service' : 'All systems operational'}
          </div>
          <div className="mt-2 font-mono text-[10px] text-sidebar-foreground/30">v0.4.2 · Australia</div>
        </div>
      </aside>
      <div className="md:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-[62px] items-center justify-between border-b border-border/80 bg-background/90 px-5 backdrop-blur-md md:px-9">
          <Link href="/" data-testid="link-mobile-brand" className="flex items-center gap-2 text-sm text-muted-foreground md:pointer-events-none">
            <Activity size={15} className="text-primary" />
            <span className="hidden sm:inline">Evidence first. Reports that stand up.</span>
            <span className="sm:hidden font-semibold text-foreground">SiteCheck <span className="text-primary">AU</span></span>
          </Link>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => signOut({ redirectUrl: basePath || '/' })} className="hidden items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted sm:flex"><LogOut size={15} /> Sign out</button>
            <Link href="/inspections" data-testid="link-header-inspections" className="hidden items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground sm:flex">
              <Search size={15} /> Find inspection
            </Link>
            <Link href="/pricing" data-testid="link-header-pricing" className="hidden items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground sm:flex">
              <CreditCard size={15} /> Plans
            </Link>
            <Link href="/inspections?new=1" data-testid="button-header-new-inspection" className="btn-primary">
              <Plus size={16} /> <span className="hidden sm:inline">New inspection</span><span className="sm:hidden">New</span>
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-[1480px] px-5 py-7 md:px-9 md:py-9">{children}</main>
      </div>
    </div>
  );
}
