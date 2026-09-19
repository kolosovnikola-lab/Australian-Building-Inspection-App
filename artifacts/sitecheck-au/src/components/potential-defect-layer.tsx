import { useState, type MouseEvent } from 'react';
import { AlertTriangle, BookOpen, Check, Crosshair, MapPin, Plus, ScanLine, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListPotentialDefectsQueryKey,
  useCreatePotentialDefect,
  useListPotentialDefects,
  useListStandards,
  useUpdatePotentialDefect,
  type PotentialDefect,
} from '@workspace/api-client-react';
import { titleCase } from '@/components/ui-pieces';

export function PotentialDefectLayer({ inspectionId }: { inspectionId: number }) {
  const queryClient = useQueryClient();
  const alerts = useListPotentialDefects(inspectionId, { query: { queryKey: getListPotentialDefectsQueryKey(inspectionId) } });
  const standards = useListStandards();
  const createAlert = useCreatePotentialDefect();
  const updateAlert = useUpdatePotentialDefect();
  const [placing, setPlacing] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState<number | null>(null);
  const [point, setPoint] = useState({ x: 50, y: 48 });
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [pageReference, setPageReference] = useState('');
  const [standardId, setStandardId] = useState<number | null>(null);
  const items = alerts.data ?? [];
  const selected = items.find((item) => item.id === selectedAlert) ?? items.find((item) => item.status === 'potential');
  const selectedStandard = standards.data?.find((standard) => standard.id === standardId) ?? standards.data?.[0];
  const refresh = () => queryClient.invalidateQueries({ queryKey: getListPotentialDefectsQueryKey(inspectionId) });
  const placeMarker = (event: MouseEvent<HTMLDivElement>) => {
    if (!placing) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setPoint({ x: Math.round(((event.clientX - rect.left) / rect.width) * 100), y: Math.round(((event.clientY - rect.top) / rect.height) * 100) });
  };
  const save = () => {
    if (!selectedStandard || !title.trim() || !pageReference.trim()) return;
    createAlert.mutate({
      id: inspectionId,
      data: {
        detectionSource: 'manual',
        title: title.trim(),
        note: note.trim() || null,
        anchorX: point.x,
        anchorY: point.y,
        standardCode: selectedStandard.code,
        standardTitle: selectedStandard.title,
        clauseNumber: selectedStandard.clause,
        clauseExtract: selectedStandard.requirement,
        pageReference: pageReference.trim(),
        sourceEdition: selectedStandard.source,
      },
    }, { onSuccess: (alert) => { setPlacing(false); setSelectedAlert(alert.id); setTitle(''); setNote(''); setPageReference(''); refresh(); } });
  };
  const setStatus = (alert: PotentialDefect, status: 'confirmed' | 'dismissed') => updateAlert.mutate({ id: alert.id, data: { status } }, { onSuccess: refresh });

  return <section data-testid="potential-defect-layer" className="overflow-hidden rounded-lg border border-[#D4A36A]/50 bg-card shadow-sm">
    <div className="flex flex-col justify-between gap-3 border-b border-border p-5 sm:flex-row sm:items-center"><div><div className="flex items-center gap-2"><ScanLine size={16} className="text-[#B7652D]" /><div className="eyebrow">AR-ready site view</div></div><h2 className="mt-1 text-lg font-semibold">Potential defect alerts</h2><p className="mt-1 text-xs text-muted-foreground">Place a marker where work may be non-compliant, then verify it against a licensed standards source.</p></div><button onClick={() => setPlacing(!placing)} data-testid="button-flag-potential-defect" className={placing ? 'btn-secondary' : 'btn-primary'}>{placing ? <X size={15} /> : <Plus size={15} />}{placing ? 'Cancel placement' : 'Flag potential defect'}</button></div>
    <div className="grid lg:grid-cols-[1.2fr_.8fr]">
      <div className="p-5">
        <div onClick={placeMarker} className={`relative aspect-[16/9] overflow-hidden rounded-lg border border-[#365552]/35 bg-[#203B39] ${placing ? 'cursor-crosshair ring-2 ring-[#D98B4E]/40' : ''}`} style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.055) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.055) 1px, transparent 1px), radial-gradient(circle at 60% 55%, #48645f 0, #294744 38%, #183230 100%)', backgroundSize: '32px 32px, 32px 32px, auto' }}>
          <div className="absolute left-4 top-4 flex items-center gap-2 rounded bg-black/30 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/80"><Crosshair size={12} /> {placing ? 'Tap work area to place marker' : 'Manual site-view overlay'}</div>
          <div className="absolute inset-x-[18%] bottom-[18%] h-[34%] skew-x-[-8deg] rounded border border-white/15 bg-white/5" />
          {items.filter((alert) => alert.status !== 'dismissed').map((alert) => <button key={alert.id} onClick={(event) => { event.stopPropagation(); setSelectedAlert(alert.id); }} aria-label={`Open ${alert.title}`} className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white p-2 shadow-lg transition hover:scale-110 ${alert.status === 'confirmed' ? 'bg-[#2F7E72] text-white' : 'animate-pulse bg-[#D9783D] text-white'}`} style={{ left: `${alert.anchorX}%`, top: `${alert.anchorY}%` }}><AlertTriangle size={16} /></button>)}
          {placing && <div className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-white bg-[#D9783D]/70 p-3 text-white" style={{ left: `${point.x}%`, top: `${point.y}%` }}><MapPin size={18} /></div>}
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-muted-foreground"><span className="rounded-full bg-[#D9783D]/10 px-2 py-1 text-[#A75024]">{items.filter((a) => a.status === 'potential').length} potential</span><span className="rounded-full bg-primary/10 px-2 py-1 text-primary">{items.filter((a) => a.status === 'confirmed').length} confirmed</span><span>AR detection can populate the same marker coordinates and reference fields later.</span></div>
      </div>
      <aside className="border-t border-border bg-muted/35 p-5 lg:border-l lg:border-t-0">
        {placing ? <div className="space-y-3"><div><div className="eyebrow">New manual alert</div><h3 className="mt-1 font-semibold">Potential non-compliant work</h3></div><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Stair balustrade appears too low" className="field-input" data-testid="input-potential-defect-title" /><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="What did you observe?" className="field-input min-h-20 resize-y" />
          <label className="block text-xs font-semibold">Australian Standard<select value={selectedStandard?.id ?? ''} onChange={(event) => setStandardId(Number(event.target.value))} className="field-input mt-1.5"><option value="" disabled>Select a reference</option>{standards.data?.map((standard) => <option key={standard.id} value={standard.id}>{standard.code} · cl {standard.clause}</option>)}</select></label>
          {selectedStandard && <StandardsExtract code={selectedStandard.code} title={selectedStandard.title} clause={selectedStandard.clause} extract={selectedStandard.requirement} page={pageReference || 'Enter verified page below'} source={selectedStandard.source} />}
          <input value={pageReference} onChange={(event) => setPageReference(event.target.value)} placeholder="Verified page, e.g. p. 42" className="field-input" data-testid="input-standard-page-reference" /><p className="text-[10px] leading-relaxed text-muted-foreground">Page numbering can vary by edition. Verify this against your organisation’s licensed copy before saving.</p><button onClick={save} disabled={!title.trim() || !pageReference.trim() || !selectedStandard || createAlert.isPending} className="btn-primary w-full" data-testid="button-save-potential-defect"><AlertTriangle size={15} />Display potential defect</button></div>
        : selected ? <div><div className="flex items-start justify-between gap-3"><div><span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${selected.status === 'confirmed' ? 'bg-primary/10 text-primary' : 'bg-[#D9783D]/10 text-[#A75024]'}`}>{titleCase(selected.status)} defect</span><h3 className="mt-3 text-base font-semibold">{selected.title}</h3>{selected.note && <p className="mt-1 text-xs text-muted-foreground">{selected.note}</p>}</div><AlertTriangle className="shrink-0 text-[#D9783D]" /></div><div className="mt-4"><StandardsExtract code={selected.standardCode} title={selected.standardTitle} clause={selected.clauseNumber} extract={selected.clauseExtract} page={selected.pageReference} source={selected.sourceEdition} /></div>{selected.status === 'potential' && <div className="mt-4 grid grid-cols-2 gap-2"><button onClick={() => setStatus(selected, 'dismissed')} className="btn-secondary"><X size={14} /> Dismiss</button><button onClick={() => setStatus(selected, 'confirmed')} className="btn-primary"><Check size={14} /> Confirm defect</button></div>}</div>
        : <div className="flex min-h-64 flex-col items-center justify-center text-center"><Crosshair size={28} className="text-muted-foreground/45" /><h3 className="mt-3 text-sm font-semibold">No potential defects flagged</h3><p className="mt-1 max-w-xs text-xs text-muted-foreground">Use inspector experience now; future AR detections will appear in this same view.</p></div>}
      </aside>
    </div>
  </section>;
}

function StandardsExtract({ code, title, clause, extract, page, source }: { code: string; title: string; clause: string; extract: string; page: string; source: string }) {
  return <div className="rounded-md border border-primary/20 bg-background p-3"><div className="flex items-start gap-2"><BookOpen size={15} className="mt-0.5 shrink-0 text-primary" /><div><p className="font-mono text-xs font-semibold text-primary">{code} · Clause {clause}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{title}</p></div></div><blockquote className="mt-3 border-l-2 border-primary/30 pl-3 text-xs leading-relaxed text-foreground/80">{extract}</blockquote><div className="mt-3 flex flex-wrap justify-between gap-2 border-t border-border pt-2 text-[10px] text-muted-foreground"><span>Page: <strong className="text-foreground">{page}</strong></span><span>{source}</span></div><p className="mt-2 text-[9px] leading-relaxed text-muted-foreground">Field reference only. Confirm wording, page and applicability in the current licensed edition.</p></div>;
}