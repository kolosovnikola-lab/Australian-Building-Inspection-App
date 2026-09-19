import { AlertTriangle, Check, CircleDashed, FileText, MapPin, Ruler, X } from 'lucide-react';
import type { Finding, Inspection, InspectionStatus } from '@workspace/api-client-react';

export const formatDate = (value?: string) => value ? new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value)) : '—';
export const formatShortDate = (value?: string) => value ? new Intl.DateTimeFormat('en-AU', { day: '2-digit', month: 'short' }).format(new Date(value)) : '—';
export const titleCase = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

export function StatusBadge({ status }: { status: InspectionStatus }) {
  const config = { draft: ['Draft', 'bg-muted text-muted-foreground'], in_progress: ['In progress', 'bg-accent/20 text-foreground'], complete: ['Complete', 'bg-primary/12 text-primary'] }[status];
  return <span data-testid={`status-inspection-${status}`} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${config[1]}`}><span className={`status-dot ${status === 'complete' ? 'bg-primary' : status === 'in_progress' ? 'bg-accent' : 'bg-muted-foreground/50'}`} />{config[0]}</span>;
}

export function SeverityBadge({ severity }: { severity: Finding['severity'] }) {
  const config = {
    critical: ['Critical', 'bg-destructive/12 text-destructive border-destructive/20'],
    high: ['High risk', 'bg-[#E8D7C4] text-[#8A4C2C] border-[#D9BA9C]'],
    medium: ['Medium', 'bg-accent/18 text-[#8A5B16] border-accent/25'],
    low: ['Low', 'bg-primary/10 text-primary border-primary/15'],
    advisory: ['Advisory', 'bg-muted text-muted-foreground border-border'],
  }[severity];
  return <span data-testid={`badge-severity-${severity}`} className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${config[1]}`}>{config[0]}</span>;
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  return <div className="flex min-h-[210px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/50 px-6 text-center">
    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground"><CircleDashed size={19} /></div>
    <h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">{detail}</p>{action && <div className="mt-4">{action}</div>}
  </div>;
}

export function ErrorState({ retry }: { retry: () => void }) {
  return <div className="flex min-h-[210px] flex-col items-center justify-center rounded-lg border border-destructive/20 bg-destructive/5 px-6 text-center">
    <AlertTriangle size={22} className="mb-3 text-destructive" /><h3 className="text-sm font-semibold">Could not load this view</h3><p className="mt-1 text-xs text-muted-foreground">The service may be offline. Your work is safe to retry.</p><button onClick={retry} data-testid="button-retry" className="btn-secondary mt-4">Try again</button>
  </div>;
}

export function LoadingRows({ count = 4 }: { count?: number }) {
  return <div className="space-y-2">{Array.from({ length: count }).map((_, i) => <div key={i} className="h-[68px] animate-pulse rounded-md bg-muted/70" />)}</div>;
}

export function InspectionRow({ inspection }: { inspection: Inspection }) {
  return <div data-testid={`row-inspection-${inspection.id}`} className="group grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border-b border-border/70 px-1 py-4 transition-colors hover:bg-muted/45 md:grid-cols-[1fr_1fr_auto]">
    <div className="min-w-0"><div className="flex items-center gap-2"><FileText size={14} className="shrink-0 text-primary" /><span className="truncate text-sm font-semibold">{inspection.title}</span></div><div className="mt-1 flex items-center gap-1.5 truncate pl-5 text-xs text-muted-foreground"><MapPin size={12} />{inspection.propertyAddress}</div><div className="mt-1 pl-5 font-mono text-[10px] uppercase tracking-wider text-primary/80">{titleCase(inspection.reportType)}</div></div>
    <div className="hidden md:block"><div className="text-xs font-medium">{inspection.clientName}</div><div className="mt-1 font-mono text-[10px] text-muted-foreground">{formatDate(inspection.inspectionDate)}</div></div>
    <div className="flex flex-col items-end gap-2"><StatusBadge status={inspection.status} /><div className="font-mono text-[10px] text-muted-foreground">{inspection.findingsCount} finding{inspection.findingsCount === 1 ? '' : 's'}</div></div>
  </div>;
}

export function Measurement({ value, unit }: { value?: number | null; unit?: string | null }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">Not recorded</span>;
  return <span className="inline-flex items-center gap-1 font-mono text-xs"><Ruler size={13} className="text-primary" />{value} {unit}</span>;
}

export function AssessmentMark({ assessment }: { assessment: Finding['assessment'] }) {
  const good = assessment === 'compliant';
  return <span className={`inline-flex items-center gap-1 text-xs font-medium ${good ? 'text-primary' : assessment === 'monitor' ? 'text-[#8A5B16]' : 'text-destructive'}`}>{good ? <Check size={14} /> : <X size={14} />}{titleCase(assessment)}</span>;
}