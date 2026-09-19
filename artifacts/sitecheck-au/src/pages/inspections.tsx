import { useEffect, useState } from 'react';
import { ChevronRight, Filter, Plus, Search, X } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useCreateInspection, useListInspections, getListInspectionsQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { ErrorState, EmptyState, InspectionRow, LoadingRows } from '@/components/ui-pieces';
import { WorkspaceUsageCard } from '@/components/workspace-usage-card';

const statuses = [{ value: '', label: 'All statuses' }, { value: 'in_progress', label: 'In progress' }, { value: 'draft', label: 'Draft' }, { value: 'complete', label: 'Complete' }] as const;
const reportTypes = [
  { value: 'pre_purchase', label: 'Pre-purchase' },
  { value: 'new_construction', label: 'New construction' },
  { value: 'pest', label: 'Pest inspection' },
  { value: 'dilapidation', label: 'Dilapidation' },
  { value: 'handover', label: 'Handover' },
  { value: 'insurance_assessment', label: 'Insurance assessment' },
  { value: 'other', label: 'Other / pools etc.' },
] as const;
type ReportType = typeof reportTypes[number]['value'];

export function InspectionsPage() {
  const [location] = useLocation();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [dialogOpen, setDialogOpen] = useState(() => new URLSearchParams(window.location.search).get('new') === '1');
  const query = useListInspections({ search: search || undefined, status: status ? status as 'draft' | 'in_progress' | 'complete' : undefined });
  const inspections = query.data ?? [];
  const hasFilters = Boolean(search || status);
  useEffect(() => { if (new URLSearchParams(window.location.search).get('new') === '1') setDialogOpen(true); }, [location]);
  return <div className="animate-rise-in space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div className="eyebrow">Field register</div><h1 className="mt-2 text-3xl font-semibold tracking-[-.04em]">Inspections</h1><p className="mt-2 text-sm text-muted-foreground">Every site visit, one traceable record.</p></div><button onClick={() => setDialogOpen(true)} data-testid="button-create-inspection" className="btn-primary w-fit"><Plus size={16} /> New inspection</button></div>
     <WorkspaceUsageCard compact />
    <div className="flex flex-col gap-2 sm:flex-row"><label className="relative flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} data-testid="input-search-inspections" placeholder="Search title, address or client" className="field-input pl-9" /></label><div className="flex gap-2"><select value={status} onChange={(event) => setStatus(event.target.value)} data-testid="select-inspection-status" className="field-input min-w-[155px]"><option value="">All statuses</option>{statuses.slice(1).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>{hasFilters && <button onClick={() => { setSearch(''); setStatus(''); }} data-testid="button-clear-inspection-filters" className="btn-secondary px-3"><X size={15} /></button>}</div></div>
    <div className="rounded-lg border border-card-border bg-card p-4 shadow-sm sm:p-5"><div className="mb-2 flex items-center justify-between"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Filter size={14} /> {query.isLoading ? 'Loading register…' : `${inspections.length} record${inspections.length === 1 ? '' : 's'}`}</div><span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Sorted by recent</span></div>
      {query.isLoading ? <LoadingRows /> : query.isError ? <ErrorState retry={() => query.refetch()} /> : inspections.length ? <div>{inspections.map((inspection) => <Link href={`/inspections/${inspection.id}`} key={inspection.id} data-testid={`link-inspection-${inspection.id}`} className="block"><InspectionRow inspection={inspection} /></Link>)}</div> : <EmptyState title={hasFilters ? 'No inspections match' : 'Your register is clear'} detail={hasFilters ? 'Try a different address, client or status.' : 'Create a record before you arrive on site so the evidence trail starts clean.'} action={!hasFilters && <button onClick={() => setDialogOpen(true)} data-testid="button-empty-create-inspection" className="btn-primary"><Plus size={15} /> Create inspection</button>} />}
    </div>
    {dialogOpen && <CreateInspectionDialog close={() => setDialogOpen(false)} onCreated={() => queryClient.invalidateQueries({ queryKey: getListInspectionsQueryKey() })} />}
  </div>;
}

function CreateInspectionDialog({ close, onCreated }: { close: () => void; onCreated: () => void }) {
  const [, navigate] = useLocation();
  const mutation = useCreateInspection();
  const [form, setForm] = useState({ title: '', propertyAddress: '', clientName: '', clientEmail: '', inspectionDate: new Date().toISOString().slice(0, 10), inspectorName: 'Alex Morgan', reportType: 'pre_purchase' as ReportType, status: 'draft' as 'draft' | 'in_progress' | 'complete' });
  const [error, setError] = useState('');
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: React.FormEvent) => { event.preventDefault(); setError(''); if (!form.title || !form.propertyAddress || !form.clientName || !form.inspectorName) { setError('Add a title, property, client and inspector to continue.'); return; } const { clientEmail, ...required } = form; mutation.mutate({ data: { ...required, ...(clientEmail ? { clientEmail } : {}) } }, { onSuccess: (inspection) => { onCreated(); close(); navigate(`/inspections/${inspection.id}`); }, onError: () => setError('Could not create this inspection. Check the connection and try again.') }); };
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/35 p-0 backdrop-blur-sm sm:items-center sm:p-4"><div role="dialog" aria-modal="true" className="animate-rise-in w-full max-w-lg rounded-t-xl border border-border bg-card p-6 shadow-2xl sm:rounded-xl"><div className="flex items-start justify-between"><div><div className="eyebrow">New record</div><h2 className="mt-1 text-xl font-semibold">Set up an inspection</h2><p className="mt-1 text-xs text-muted-foreground">A few details now. Evidence and findings on site.</p></div><button onClick={close} data-testid="button-close-create-inspection" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"><X size={18} /></button></div>
      <form onSubmit={submit} className="mt-6 space-y-4"><Field label="Inspection title" value={form.title} placeholder="Pre-purchase · Hawthorn" onChange={(v) => update('title', v)} testId="input-inspection-title" /><Field label="Property address" value={form.propertyAddress} placeholder="18 Lygon Street, Carlton VIC" onChange={(v) => update('propertyAddress', v)} testId="input-inspection-address" /><div className="grid gap-4 md:grid-cols-2"><Field label="Client" value={form.clientName} placeholder="Client or agency name" onChange={(v) => update('clientName', v)} testId="input-inspection-client" /><Field label="Client email" type="email" value={form.clientEmail} placeholder="client@example.com" onChange={(v) => update('clientEmail', v)} testId="input-inspection-client-email" /></div><div className="grid gap-4 md:grid-cols-2"><Field label="Inspector" value={form.inspectorName} placeholder="Your name" onChange={(v) => update('inspectorName', v)} testId="input-inspection-inspector" /><Field label="Inspection date" type="date" value={form.inspectionDate} onChange={(v) => update('inspectionDate', v)} testId="input-inspection-date" /></div><div className="grid gap-4 md:grid-cols-2"><label className="block"><span className="mb-1.5 block text-xs font-semibold">Report type</span><select value={form.reportType} onChange={(e) => update('reportType', e.target.value)} data-testid="select-new-inspection-report-type" className="field-input">{reportTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label><label className="block"><span className="mb-1.5 block text-xs font-semibold">Starting status</span><select value={form.status} onChange={(e) => update('status', e.target.value)} data-testid="select-new-inspection-status" className="field-input"><option value="draft">Draft</option><option value="in_progress">In progress</option></select></label></div>{error && <p data-testid="text-create-inspection-error" className="text-xs text-destructive">{error}</p>}<div className="flex justify-end gap-2 pt-2"><button type="button" onClick={close} data-testid="button-cancel-create-inspection" className="btn-secondary">Cancel</button><button type="submit" disabled={mutation.isPending} data-testid="button-submit-create-inspection" className="btn-primary">{mutation.isPending ? 'Creating…' : 'Create inspection'}<ChevronRight size={15} /></button></div></form>
  </div></div>;
}

function Field({ label, value, placeholder, onChange, testId, type = 'text' }: { label: string; value: string; placeholder?: string; onChange: (value: string) => void; testId: string; type?: string }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-semibold">{label}</span><input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} data-testid={testId} className="field-input" /></label>;
}