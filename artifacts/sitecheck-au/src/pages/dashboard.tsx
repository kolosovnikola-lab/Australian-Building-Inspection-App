import { ArrowUpRight, BarChart3, ClipboardCheck, FileWarning, Plus, ShieldAlert, Sparkles } from 'lucide-react';
import { Link } from 'wouter';
import { useGetDashboard } from '@workspace/api-client-react';
import { ErrorState, InspectionRow, LoadingRows, titleCase } from '@/components/ui-pieces';
import { WorkspaceUsageCard } from '@/components/workspace-usage-card';

export function DashboardPage() {
  const query = useGetDashboard();
  const summary = query.data;
  if (query.isLoading) return <div className="animate-rise-in"><PageIntro /><LoadingRows count={5} /></div>;
  if (query.isError || !summary) return <><PageIntro /><ErrorState retry={() => query.refetch()} /></>;
  const severity = summary.severityCounts;
  const metrics = [
    { label: 'Active inspections', value: summary.activeInspections, detail: 'draft + in progress', icon: ClipboardCheck, tone: 'text-primary' },
    { label: 'Open findings', value: summary.openFindings, detail: `${summary.highRiskFindings} high risk`, icon: FileWarning, tone: 'text-[#A96137]' },
    { label: 'Completed this period', value: summary.completedInspections, detail: 'ready for delivery', icon: BarChart3, tone: 'text-[#827044]' },
  ];
  return <div className="animate-rise-in space-y-7">
    <PageIntro />
    <section className="grid gap-3 md:grid-cols-3">
      {metrics.map(({ label, value, detail, icon: Icon, tone }, index) => <div key={label} className={`animate-rise-in delay-${index + 1} rounded-lg border border-card-border bg-card p-5 shadow-sm`}>
        <div className="flex items-start justify-between"><span className="eyebrow">{label}</span><Icon size={17} className={tone} /></div>
        <div data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`} className="mt-4 font-mono text-3xl font-medium tracking-tight">{value}</div><div className="mt-1 text-xs text-muted-foreground">{detail}</div>
      </div>)}
    </section>
    <WorkspaceUsageCard />
    <section className="grid gap-5 lg:grid-cols-[1.4fr_.9fr]">
      <div className="rounded-lg border border-card-border bg-card p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between"><div><div className="eyebrow">Latest field activity</div><h2 className="mt-1 text-lg font-semibold tracking-tight">Recent inspections</h2></div><Link href="/inspections" data-testid="link-view-all-inspections" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">View all <ArrowUpRight size={14} /></Link></div>
        {summary.recentInspections.length ? <div>{summary.recentInspections.map((inspection) => <Link href={`/inspections/${inspection.id}`} key={inspection.id} data-testid={`link-recent-inspection-${inspection.id}`} className="block"><InspectionRow inspection={inspection} /></Link>)}</div> : <div className="py-12"><EmptyDashboard /></div>}
      </div>
      <div className="site-grid relative overflow-hidden rounded-lg border border-[#365552] bg-[#254541] p-5 text-[#F5F0E5]">
        <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full border border-[#7FA9A0]/25" /><div className="absolute -right-2 -top-2 h-16 w-16 rounded-full border border-[#7FA9A0]/25" />
        <div className="relative"><div className="eyebrow text-[#BBD1C7]">Risk pulse</div><h2 className="mt-1 text-lg font-semibold">Severity at a glance</h2>
          <div className="mt-7 space-y-4">{Object.entries(severity).map(([key, count]) => <div key={key}><div className="mb-1.5 flex justify-between text-xs"><span>{titleCase(key)}</span><span className="font-mono text-[#BBD1C7]">{count}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[#183532]"><div className={`h-full rounded-full ${key === 'critical' ? 'bg-[#E57C68]' : key === 'high' ? 'bg-[#E0A26A]' : key === 'medium' ? 'bg-[#D8C07C]' : 'bg-[#8AB8A6]'}`} style={{ width: `${Math.max(count ? 12 : 0, (count / Math.max(summary.openFindings, 1)) * 100)}%` }} /></div></div>)}</div>
          <div className="mt-8 flex items-center gap-2 border-t border-[#7FA9A0]/25 pt-4 text-xs text-[#BBD1C7]"><ShieldAlert size={15} /> High-risk items need a traceable recommendation.</div>
        </div>
      </div>
    </section>
    <section className="flex flex-col justify-between gap-4 rounded-lg border border-border bg-[#EEE8D8] p-5 sm:flex-row sm:items-center"><div className="flex gap-3"><Sparkles size={18} className="mt-0.5 text-primary" /><div><div className="text-sm font-semibold">Start with the observation, not the conclusion.</div><p className="mt-1 text-xs text-muted-foreground">Use a standard reference to make every recommendation defensible.</p></div></div><Link href="/inspections?new=1" data-testid="link-dashboard-new-inspection" className="btn-secondary shrink-0"><Plus size={15} /> New inspection</Link></section>
  </div>;
}

function PageIntro() { return <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div className="eyebrow">Monday, 14 October 2024 · Melbourne</div><h1 className="mt-2 text-3xl font-semibold tracking-[-.04em] sm:text-4xl">Good morning, Alex.</h1><p className="mt-2 text-sm text-muted-foreground">Here’s the state of your inspection workbench.</p></div><Link href="/inspections?new=1" data-testid="button-dashboard-new" className="btn-primary w-fit"><Plus size={16} /> New inspection</Link></div>; }
function EmptyDashboard() { return <div className="text-center"><div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted"><ClipboardCheck size={18} className="text-muted-foreground" /></div><p className="text-sm font-medium">No inspection activity yet</p><Link href="/inspections?new=1" data-testid="link-empty-new-inspection" className="mt-2 inline-block text-xs font-semibold text-primary hover:underline">Create your first inspection →</Link></div>; }