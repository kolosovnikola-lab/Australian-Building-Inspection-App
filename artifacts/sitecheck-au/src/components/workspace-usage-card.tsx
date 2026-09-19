import { AlertTriangle, ArrowUpRight, CheckCircle2, Database, FileCheck2, Sparkles, Users } from 'lucide-react';
import { Link } from 'wouter';
import { useGetWorkspaceUsage } from '@workspace/api-client-react';
import type { UsageMetric } from '@workspace/api-client-react';
import { ErrorState, LoadingRows } from './ui-pieces';

function formatUsage(metric: UsageMetric) {
  if (metric.unit !== 'bytes') return `${metric.used.toLocaleString()} / ${metric.limit.toLocaleString()}`;
  const toGb = (value: number) => value / 1_000_000_000;
  return `${toGb(metric.used).toFixed(metric.used >= 1_000_000_000 ? 1 : 2)} GB / ${toGb(metric.limit).toLocaleString('en-AU')} GB`;
}

function iconForMetric(key: string) {
  if (key === 'reports' || key === 'inspections') return FileCheck2;
  if (key === 'storage') return Database;
  if (key === 'seats') return Users;
  return Sparkles;
}

export function WorkspaceUsageCard({ compact = false }: { compact?: boolean }) {
  const query = useGetWorkspaceUsage();
  if (query.isLoading) return <div className="rounded-lg border border-card-border bg-card p-5 shadow-sm"><LoadingRows count={compact ? 2 : 3} /></div>;
  if (query.isError || !query.data) return <div className="rounded-lg border border-card-border bg-card p-5 shadow-sm"><ErrorState retry={() => query.refetch()} /></div>;
  const usage = query.data;
  const importantWarnings = usage.warnings.slice(0, compact ? 1 : 2);

  return <section className={`rounded-lg border border-card-border bg-card shadow-sm ${compact ? 'p-4' : 'p-5'}`} data-testid="card-workspace-usage">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
      <div>
        <div className="eyebrow">Plan usage</div>
        <h2 className="mt-1 text-lg font-semibold tracking-tight">{usage.plan.name} plan <span className="font-mono text-[10px] font-normal uppercase tracking-wider text-muted-foreground">· {usage.plan.billingPeriod}</span></h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Current allowance · {new Date(usage.period.endsAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} reset</p>
      </div>
      <Link href="/pricing" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline" data-testid="link-usage-review-plans">Review plans <ArrowUpRight size={13} /></Link>
    </div>
    <div className={`mt-5 grid gap-3 ${compact ? 'sm:grid-cols-2' : 'md:grid-cols-5'}`}>
      {usage.metrics.map((metric) => {
        const Icon = iconForMetric(metric.key);
        const stateClass = metric.status === 'at_limit' ? 'border-destructive/30 bg-destructive/5' : metric.status === 'warning' ? 'border-[#D7A55A]/40 bg-[#D7A55A]/10' : 'border-border bg-muted/25';
        return <div key={metric.key} className={`rounded-md border p-3 ${stateClass}`} data-testid={`usage-metric-${metric.key}`}>
          <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><Icon size={13} />{metric.label}</span>{metric.status === 'healthy' ? <CheckCircle2 size={13} className="text-primary" /> : <AlertTriangle size={13} className={metric.status === 'at_limit' ? 'text-destructive' : 'text-[#855B1B]'} />}</div>
          <div className="mt-2 flex items-baseline justify-between gap-2"><span className="font-mono text-sm font-medium">{formatUsage(metric)}</span><span className="text-[10px] text-muted-foreground">{metric.remaining.toLocaleString()} left</span></div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background"><div className={`h-full rounded-full ${metric.status === 'at_limit' ? 'bg-destructive' : metric.status === 'warning' ? 'bg-[#C58C3D]' : 'bg-primary'}`} style={{ width: `${metric.percentUsed}%` }} /></div>
        </div>;
      })}
    </div>
    {importantWarnings.length > 0 && <div className="mt-4 space-y-2 rounded-md border border-[#D7A55A]/40 bg-[#D7A55A]/10 p-3 text-xs text-[#855B1B]" role="status" data-testid="usage-warning">
      {importantWarnings.map((warning) => <p key={warning} className="flex items-start gap-2"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{warning} <Link href="/pricing" className="font-semibold underline">See options</Link></p>)}
    </div>}
    {importantWarnings.length === 0 && !compact && <p className="mt-4 text-xs text-muted-foreground">You have room to keep working. We’ll show a warning before an allowance is reached.</p>}
  </section>;
}