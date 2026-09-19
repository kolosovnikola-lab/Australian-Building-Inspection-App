import { useState } from 'react';
import { Archive, Clock3, Pencil, Plus, RotateCcw, Save, X } from 'lucide-react';
import { useAuth } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListClientLanguageGlossaryQueryKey,
  getListClientLanguageGlossaryHistoryQueryKey,
  getListManagedClientLanguageGlossaryQueryKey,
  useCreateClientLanguageGlossaryTerm,
  useListManagedClientLanguageGlossary,
  useListClientLanguageGlossaryHistory,
  useUpdateClientLanguageGlossaryTerm,
} from '@workspace/api-client-react';

type EditingTerm = { id: number; term: string; suggestedMeaning: string };

export function ClientLanguageGlossaryPage() {
  const { sessionClaims } = useAuth();
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role;
  const isManager = role === 'manager' || role === 'admin';
  const queryClient = useQueryClient();
  const glossary = useListManagedClientLanguageGlossary({
    query: { queryKey: getListManagedClientLanguageGlossaryQueryKey(), enabled: isManager },
  });
  const history = useListClientLanguageGlossaryHistory({
    query: { queryKey: getListClientLanguageGlossaryHistoryQueryKey(), enabled: isManager },
  });
  const create = useCreateClientLanguageGlossaryTerm();
  const update = useUpdateClientLanguageGlossaryTerm();
  const [editing, setEditing] = useState<EditingTerm | null>(null);
  const [newTerm, setNewTerm] = useState('');
  const [newMeaning, setNewMeaning] = useState('');
  const [error, setError] = useState('');

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListManagedClientLanguageGlossaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListClientLanguageGlossaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListClientLanguageGlossaryHistoryQueryKey() });
  };
  const addTerm = (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    create.mutate(
      { data: { term: newTerm.trim(), suggestedMeaning: newMeaning.trim() } },
      {
        onSuccess: () => {
          setNewTerm('');
          setNewMeaning('');
          refresh();
        },
        onError: () => setError('That term could not be added. Check that it is not already in the glossary.'),
      },
    );
  };
  const saveTerm = () => {
    if (!editing) return;
    setError('');
    update.mutate(
      { id: editing.id, data: { term: editing.term.trim(), suggestedMeaning: editing.suggestedMeaning.trim() } },
      {
        onSuccess: () => {
          setEditing(null);
          refresh();
        },
        onError: () => setError('That term could not be saved. Check that it is not already in the glossary.'),
      },
    );
  };
  const toggleActive = (id: number, active: boolean) => {
    setError('');
    update.mutate(
      { id, data: { active } },
      { onSuccess: refresh, onError: () => setError('The glossary status could not be changed. Try again.') },
    );
  };

  if (!isManager) {
    return <div className="rounded-lg border border-card-border bg-card p-6 shadow-sm"><h1 className="text-xl font-semibold">Manager access required</h1><p className="mt-2 text-sm text-muted-foreground">Client-language guidance is managed by workspace managers.</p></div>;
  }

  return <div className="animate-rise-in space-y-6">
    <div>
      <div className="eyebrow">Workspace settings</div>
      <h1 className="mt-2 text-3xl font-semibold tracking-[-.04em]">Client language glossary</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Manage the terms inspectors may want to explain in simpler words. Guidance is advisory only; it never rewrites or blocks an explanation.</p>
    </div>

    <section className="rounded-lg border border-card-border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-semibold"><Plus size={16} className="text-primary" /> Add a glossary term</div>
      <form onSubmit={addTerm} className="mt-4 grid gap-3 md:grid-cols-[1fr_1.5fr_auto]">
        <input value={newTerm} onChange={(event) => setNewTerm(event.target.value)} placeholder="e.g. rising damp" aria-label="New glossary term" className="field-input" maxLength={80} required />
        <input value={newMeaning} onChange={(event) => setNewMeaning(event.target.value)} placeholder="Suggested plain-language meaning" aria-label="Suggested plain-language meaning" className="field-input" maxLength={240} required />
        <button type="submit" disabled={create.isPending} className="btn-primary">{create.isPending ? 'Adding…' : 'Add term'}</button>
      </form>
    </section>

    {error && <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>}

    <section className="rounded-lg border border-card-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div><h2 className="text-sm font-semibold">Workspace terms</h2><p className="mt-1 text-xs text-muted-foreground">Active terms appear in finding guidance and report-readiness checks.</p></div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{glossary.isLoading ? 'Loading…' : `${glossary.data?.filter((term) => term.active).length ?? 0} active`}</span>
      </div>
      {glossary.isError && <p className="text-sm text-destructive">The glossary could not be loaded. Refresh and try again.</p>}
      {!glossary.isLoading && !glossary.data?.length && <p className="rounded-md bg-muted/50 px-3 py-3 text-xs text-muted-foreground">No glossary terms have been added yet.</p>}
      <div className="space-y-2">
        {glossary.data?.map((item) => editing?.id === item.id ? (
          <div key={item.id} className="rounded-md border border-primary/30 bg-primary/5 p-3">
            <div className="grid gap-3 md:grid-cols-2">
              <input value={editing.term} onChange={(event) => setEditing({ ...editing, term: event.target.value })} aria-label={`Edit term ${item.term}`} className="field-input" maxLength={80} />
              <input value={editing.suggestedMeaning} onChange={(event) => setEditing({ ...editing, suggestedMeaning: event.target.value })} aria-label={`Edit meaning for ${item.term}`} className="field-input" maxLength={240} />
            </div>
            <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setEditing(null)} className="btn-secondary"><X size={14} /> Cancel</button><button type="button" onClick={saveTerm} disabled={update.isPending} className="btn-primary"><Save size={14} /> {update.isPending ? 'Saving…' : 'Save'}</button></div>
          </div>
        ) : (
          <div key={item.id} className={`flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center ${item.active ? 'border-border' : 'border-border/60 bg-muted/35 opacity-75'}`}>
            <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="text-sm font-semibold">{item.term}</p><span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${item.active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>{item.active ? 'Active' : 'Retired'}</span></div><p className="mt-1 text-xs text-muted-foreground">Suggested meaning: <span className="text-foreground/80">{item.suggestedMeaning}</span></p></div>
            <div className="flex shrink-0 gap-2"><button type="button" onClick={() => setEditing({ id: item.id, term: item.term, suggestedMeaning: item.suggestedMeaning })} className="btn-secondary px-2.5 py-1.5 text-[11px]"><Pencil size={13} /> Edit</button><button type="button" onClick={() => toggleActive(item.id, !item.active)} disabled={update.isPending} className="btn-secondary px-2.5 py-1.5 text-[11px]">{item.active ? <Archive size={13} /> : <RotateCcw size={13} />}{item.active ? 'Retire' : 'Restore'}</button></div>
          </div>
        ))}
      </div>
    </section>
    <section className="rounded-lg border border-card-border bg-card p-5 shadow-sm" data-testid="glossary-change-history">
      <div className="mb-4 flex items-start gap-3">
        <Clock3 size={16} className="mt-0.5 text-primary" />
        <div>
          <h2 className="text-sm font-semibold">Change history</h2>
          <p className="mt-1 text-xs text-muted-foreground">Recent glossary changes made by workspace managers.</p>
        </div>
      </div>
      {history.isLoading && <p className="text-xs text-muted-foreground">Loading change history…</p>}
      {history.isError && <p className="text-xs text-destructive">Change history could not be loaded. Refresh and try again.</p>}
      {!history.isLoading && !history.data?.length && <p className="rounded-md bg-muted/50 px-3 py-3 text-xs text-muted-foreground">No manager changes have been recorded yet.</p>}
      <ol className="divide-y divide-border/70">
        {history.data?.map((event) => (
          <li key={event.id} className="py-3 first:pt-0 last:pb-0" data-testid={`glossary-history-event-${event.id}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold">
                {event.actorDisplayName} {event.action} “{event.term}”
              </p>
              <time className="font-mono text-[10px] text-muted-foreground" dateTime={event.happenedAt}>
                {new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.happenedAt))}
              </time>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Suggested meaning: {event.suggestedMeaning}
            </p>
            {event.action === 'edited' && event.previousTerm && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                Previously “{event.previousTerm}” — {event.previousSuggestedMeaning}
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  </div>;
}