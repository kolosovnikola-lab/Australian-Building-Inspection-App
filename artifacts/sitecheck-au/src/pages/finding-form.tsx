import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Camera, ChevronDown, Cloud, Info, Save, WandSparkles, Sparkles } from 'lucide-react';
import { Link, useLocation, useParams } from 'wouter';
import { useCompleteFindingMediaUpload, useCreateFinding, useGenerateFindingWording, useGetInspection, useListChecklist, useListClientLanguageGlossary, useRequestFindingMediaUpload, getGetInspectionQueryKey, getListChecklistQueryKey, getListClientLanguageGlossaryQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { SHARED_REPORT_EDIT_WARNING } from './shared-report-edit-warning';
import { useEditWarningDialog } from './shared-report-edit-warning-dialog';
import { DEFAULT_CLIENT_LANGUAGE_GLOSSARY, reviewClientExplanation } from './client-explanation-review';
import { WorkspaceUsageCard } from '@/components/workspace-usage-card';

const categories = ['structural', 'external', 'internal', 'wet_area', 'roofing', 'pest', 'safety', 'services'] as const;
const severities = ['critical', 'high', 'medium', 'low', 'advisory'] as const;
const assessments = ['outside_tolerance', 'non_compliant', 'monitor', 'compliant'] as const;
const pestRelevances = ['not_applicable', 'conducive_condition', 'evidence_of_activity', 'further_investigation'] as const;
const backupDestinations = ['app_only', 'device', 'company_drive'] as const;
const aiActions = [{ value: 'generate', label: 'Generate' }, { value: 'improve', label: 'Improve' }, { value: 'shorten', label: 'Shorten' }, { value: 'make_major', label: 'Make major' }, { value: 'explain_simply', label: 'Explain simply' }] as const;
type AiLength = 'concise' | 'standard' | 'detailed';
type FormState = { area: string; subCategory: string; category: typeof categories[number]; title: string; location: string; severity: typeof severities[number]; pestRelevance: typeof pestRelevances[number]; observed: string; standardRef: string; standardTitle: string; requirement: string; tolerance: string; measuredValue: string; unit: string; assessment: typeof assessments[number]; recommendation: string; clientExplanation: string; reportPhotosCount: string; evidencePhotosCount: string; backupDestination: typeof backupDestinations[number] };
type MediaDraft = { id: string; file: File; classification: 'client_report' | 'private_evidence'; progress: number; status: 'queued' | 'uploading' | 'uploaded' | 'error'; error?: string };

async function sha256File(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function loadAiPreferences(): { length: AiLength; includeTradeRecommendation: boolean } {
  try {
    const saved = JSON.parse(localStorage.getItem('sitecheck-ai-preferences') ?? '{}');
    return { length: saved.length ?? 'standard', includeTradeRecommendation: saved.includeTradeRecommendation ?? true };
  } catch {
    return { length: 'standard', includeTradeRecommendation: true };
  }
}

export function FindingFormPage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const id = Number(params.id);
  const queryClient = useQueryClient();
  const editWarning = useEditWarningDialog();
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const mutation = useCreateFinding();
  const requestMediaMutation = useRequestFindingMediaUpload();
  const completeMediaMutation = useCompleteFindingMediaUpload();
  const aiMutation = useGenerateFindingWording();
  const inspectionQuery = useGetInspection(id, { query: { queryKey: getGetInspectionQueryKey(id), enabled: Number.isFinite(id) } });
  const checklistParams = { reportType: inspectionQuery.data?.reportType ?? 'pre_purchase' } as const;
  const checklistQuery = useListChecklist(checklistParams, { query: { queryKey: getListChecklistQueryKey(checklistParams), enabled: Boolean(inspectionQuery.data?.reportType) } });
  const glossaryQuery = useListClientLanguageGlossary({ query: { queryKey: getListClientLanguageGlossaryQueryKey() } });
  const [error, setError] = useState('');
  const [aiError, setAiError] = useState('');
  const [aiPhrase, setAiPhrase] = useState('');
  const [aiPreferences, setAiPreferencesState] = useState(loadAiPreferences);
  const [mediaDrafts, setMediaDrafts] = useState<MediaDraft[]>([]);
  const [savedFindingId, setSavedFindingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>({ area: 'General', subCategory: 'General', category: 'structural', title: '', location: '', severity: 'medium', pestRelevance: 'not_applicable', observed: '', standardRef: '', standardTitle: '', requirement: '', tolerance: '', measuredValue: '', unit: 'mm', assessment: 'outside_tolerance', recommendation: '', clientExplanation: '', reportPhotosCount: '0', evidencePhotosCount: '0', backupDestination: 'app_only' });
  const checklist = checklistQuery.data ?? [];
  const areaOptions = useMemo(() => Array.from(new Set(['General', ...checklist.map((item) => item.area)])), [checklist]);
  const subCategoryOptions = useMemo(() => Array.from(new Set(['General', ...checklist.filter((item) => item.area === form.area).map((item) => item.subCategory)])), [checklist, form.area]);
  const selectedChecklist = checklist.find((item) => item.area === form.area && item.subCategory === form.subCategory);
  const glossary = glossaryQuery.data === undefined
    ? DEFAULT_CLIENT_LANGUAGE_GLOSSARY
    : glossaryQuery.data.map(({ term, suggestedMeaning }) => ({ term, suggestedMeaning }));
  const explanationWarnings = useMemo(() => reviewClientExplanation(form.clientExplanation, glossary), [form.clientExplanation, glossaryQuery.data]);
  useEffect(() => {
    if (checklist.length && form.area === 'General') {
      setForm((current) => ({ ...current, area: checklist[0].area, subCategory: checklist[0].subCategory, category: checklist[0].category }));
    }
  }, [checklist, form.area]);

  const [scanDraftLoaded, setScanDraftLoaded] = useState(false);
  useEffect(() => {
    const draftKey = `sitecheck-scan-draft-${id}`;
    try {
      const draftStr = localStorage.getItem(draftKey);
      if (draftStr) {
        const draft = JSON.parse(draftStr);
        setForm((current) => ({
          ...current,
          title: draft.title || current.title,
          category: draft.category || current.category,
          severity: draft.severity || current.severity,
          location: draft.location || current.location,
          observed: draft.observed || current.observed,
          recommendation: draft.recommendation || current.recommendation,
        }));
        setScanDraftLoaded(true);
        localStorage.removeItem(draftKey);
      }
    } catch (err) {}
  }, [id]);
  const update = (key: keyof FormState, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const addMediaFiles = (files: FileList | null, classification: MediaDraft['classification']) => {
    if (!files) return;
    const accepted = Array.from(files).filter((file) => ['image/jpeg', 'image/png', 'image/webp'].includes(file.type));
    setMediaDrafts((current) => [...current, ...accepted.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      classification,
      progress: 0,
      status: 'queued' as const,
    }))]);
  };
  const uploadMedia = async (inspectionId: number, findingId: number, draft: MediaDraft) => {
    try {
      const sha256 = await sha256File(draft.file);
      setMediaDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, progress: 10, status: 'uploading', error: undefined } : item));
      const upload = await requestMediaMutation.mutateAsync({
        id: inspectionId,
        data: { findingId, classification: draft.classification, contentType: draft.file.type as 'image/jpeg' | 'image/png' | 'image/webp', sizeBytes: draft.file.size, sha256 },
      });
      const response = await fetch(upload.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': draft.file.type, 'x-goog-meta-sha256': sha256 },
        body: draft.file,
      });
      if (!response.ok) throw new Error(`Upload failed with status ${response.status}`);
      setMediaDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, progress: 70 } : item));
      await completeMediaMutation.mutateAsync({
        id: inspectionId,
        data: { findingId, classification: draft.classification, objectPath: upload.objectPath, fileName: draft.file.name, caption: null, contentType: draft.file.type as 'image/jpeg' | 'image/png' | 'image/webp', sizeBytes: draft.file.size, sha256 },
      });
      setMediaDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, progress: 100, status: 'uploaded' } : item));
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : 'Upload failed';
      setMediaDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, status: 'error', error: message } : item));
      throw uploadError;
    }
  };
  const retryMedia = async (draft: MediaDraft) => {
    if (!savedFindingId) return;
    setError('');
    try {
      await uploadMedia(id, savedFindingId, draft);
      queryClient.invalidateQueries({ queryKey: getGetInspectionQueryKey(id) });
    } catch {
      setError('This photo still could not be uploaded. Check the connection or App Storage and try again.');
    }
  };
  const setAiPreferences = (next: { length: AiLength; includeTradeRecommendation: boolean }) => {
    setAiPreferencesState(next);
    localStorage.setItem('sitecheck-ai-preferences', JSON.stringify(next));
  };
  const generateWording = (action: typeof aiActions[number]['value']) => {
    const phrase = aiPhrase.trim() || form.title.trim() || form.observed.trim();
    if (!phrase) {
      setAiError('Enter a short defect phrase first.');
      return;
    }
    setAiError('');
    aiMutation.mutate({
      data: {
        phrase,
        action,
        length: aiPreferences.length,
        includeTradeRecommendation: aiPreferences.includeTradeRecommendation,
        existingObserved: form.observed || undefined,
        existingRecommendation: form.recommendation || undefined,
      },
    }, {
      onSuccess: (result) => setForm((current) => ({
        ...current,
        title: result.title || current.title,
        observed: result.observed || current.observed,
        recommendation: result.recommendation || current.recommendation,
        clientExplanation: result.clientExplanation || current.clientExplanation,
      })),
      onError: () => setAiError('AI wording is temporarily unavailable. Your notes were not changed.'),
    });
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    submitButtonRef.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
    const required = ['title', 'location', 'observed', 'standardRef', 'standardTitle', 'requirement', 'tolerance', 'recommendation'] as const;
    if (required.some((key) => !form[key].trim())) {
      setError('Complete each evidence field before saving this finding.');
      return;
    }
    editWarning.openSharedReportWarning({
      hasActiveLink: Boolean(inspectionQuery.data?.reportShareToken),
      trigger: submitButtonRef.current,
      description: SHARED_REPORT_EDIT_WARNING,
       onConfirm: () => mutation.mutate({ id, data: { area: form.area, subCategory: form.subCategory, category: form.category, title: form.title, location: form.location, severity: form.severity, pestRelevance: form.pestRelevance, observed: form.observed, standardRef: form.standardRef, standardTitle: form.standardTitle, requirement: form.requirement, tolerance: form.tolerance, measuredValue: form.measuredValue ? Number(form.measuredValue) : null, unit: form.measuredValue ? form.unit : null, assessment: form.assessment, recommendation: form.recommendation, clientExplanation: form.clientExplanation.trim() || null, photosCount: 0, reportPhotosCount: 0, evidencePhotosCount: 0, backupDestination: form.backupDestination } }, { onSuccess: async (finding) => { setSavedFindingId(finding.id); let failed = false; for (const draft of mediaDrafts) { if (draft.status === 'uploaded') continue; try { await uploadMedia(id, finding.id, draft); } catch { failed = true; } } queryClient.invalidateQueries({ queryKey: getGetInspectionQueryKey(id) }); if (failed) setError('The finding was saved, but one or more photos need a retry. Your selected files are still attached to this form.'); else navigate(`/inspections/${id}`); }, onError: () => setError('Could not save this finding. Check the connection and try again.') }),
    });
  };
  return <div className="animate-rise-in mx-auto max-w-4xl space-y-6">{editWarning.dialog}<div className="flex items-center gap-2 text-xs text-muted-foreground"><Link href={`/inspections/${id}`} data-testid="link-back-inspection-detail" className="inline-flex items-center gap-1 hover:text-foreground"><ArrowLeft size={14} /> Inspection</Link><span>/</span><span>New finding</span></div>
    <div><div className="eyebrow">Evidence capture · SC-{String(id).padStart(4, '0')}</div><h1 className="mt-2 text-3xl font-semibold tracking-[-.04em]">Add a finding</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Describe what you saw, anchor it to the right requirement, and leave the next person a clear action.</p></div>
    {scanDraftLoaded && <div className="rounded-lg border border-primary/20 bg-primary/5 p-4" data-testid="banner-scan-draft"><div className="flex items-start gap-3"><Sparkles size={18} className="mt-0.5 shrink-0 text-primary" /><div><h3 className="text-sm font-semibold text-primary">Draft populated from camera scan</h3><p className="mt-1 text-xs text-muted-foreground">Review and verify the suggested fields below. The captured image remains on your device and has not been uploaded to the report.</p></div></div></div>}
    <form onSubmit={submit} className="space-y-5"><section className="rounded-lg border border-card-border bg-card p-5 shadow-sm"><SectionHeading index="01" title="Classify the observation" detail="Start from the report checklist, then add the individual defect." /><div className="mt-5 grid gap-4 md:grid-cols-2"><SelectField label="Area" value={form.area} onChange={(v) => { update('area', v); const first = checklist.find((item) => item.area === v); if (first) update('subCategory', first.subCategory); }} options={areaOptions} testId="select-finding-area" /><SelectField label="Sub-category" value={form.subCategory} onChange={(v) => update('subCategory', v)} options={subCategoryOptions} testId="select-finding-subcategory" /><SelectField label="Category" value={form.category} onChange={(v) => update('category', v)} options={categories} testId="select-finding-category" /><SelectField label="Severity" value={form.severity} onChange={(v) => update('severity', v)} options={severities} testId="select-finding-severity" /><TextField label="Finding title" value={form.title} onChange={(v) => update('title', v)} placeholder="e.g. Step cracking to rear brickwork" testId="input-finding-title" /><TextField label="Location" value={form.location} onChange={(v) => update('location', v)} placeholder="e.g. South elevation, beside laundry" testId="input-finding-location" /></div>{selectedChecklist && <div className="mt-4 rounded-md bg-muted/55 px-3 py-2 text-xs leading-relaxed text-muted-foreground"><span className="font-semibold text-foreground">Checklist prompt:</span> {selectedChecklist.prompt}</div>}<div className="mt-4 max-w-md"><SelectField label="Pest relevance" value={form.pestRelevance} onChange={(v) => update('pestRelevance', v)} options={pestRelevances} testId="select-finding-pest-relevance" /></div></section>
       <section className="rounded-lg border border-card-border bg-card p-5 shadow-sm"><SectionHeading index="02" title="Record the condition" detail="Type a quick site note, then generate or refine the wording on this page." /><div className="mt-5 space-y-4"><WorkspaceUsageCard compact /><div className="rounded-lg border border-primary/20 bg-primary/5 p-4"><div className="flex items-center gap-2 text-sm font-semibold"><WandSparkles size={16} className="text-primary" /> AI wording assistant</div><p className="mt-1 text-xs text-muted-foreground">Your field note stays unchanged if generation fails. Standards and clause references are never invented.</p><div className="mt-3 grid gap-3 md:grid-cols-[1fr_150px]"><input value={aiPhrase} onChange={(event) => setAiPhrase(event.target.value)} data-testid="input-ai-defect-phrase" placeholder="e.g. cracked grout shower base" className="field-input" /><select value={aiPreferences.length} onChange={(event) => setAiPreferences({ ...aiPreferences, length: event.target.value as AiLength })} data-testid="select-ai-length" className="field-input"><option value="concise">Concise</option><option value="standard">Standard</option><option value="detailed">Detailed</option></select></div><label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={aiPreferences.includeTradeRecommendation} onChange={(event) => setAiPreferences({ ...aiPreferences, includeTradeRecommendation: event.target.checked })} /> Include relevant trade or further-inspection recommendation</label><div className="mt-3 flex flex-wrap gap-2">{aiActions.map((action) => <button key={action.value} type="button" disabled={aiMutation.isPending} onClick={() => generateWording(action.value)} data-testid={`button-ai-${action.value}`} className={action.value === 'generate' ? 'btn-primary' : 'btn-secondary'}>{aiMutation.isPending && action.value === 'generate' ? 'Generating…' : action.label}</button>)}</div>{aiError && <p className="mt-2 text-xs text-destructive">{aiError}</p>}</div><TextAreaField label="What was observed?" value={form.observed} onChange={(v) => update('observed', v)} placeholder="Describe the visible condition, extent and any relevant context." testId="textarea-finding-observed" /><div className="grid gap-4 md:grid-cols-[1fr_145px]"><TextField label="Measured value (optional)" value={form.measuredValue} onChange={(v) => update('measuredValue', v)} placeholder="e.g. 12" testId="input-finding-measurement" /><SelectField label="Assessment" value={form.assessment} onChange={(v) => update('assessment', v)} options={assessments} testId="select-finding-assessment" /></div></div></section>
      <section className="rounded-lg border border-card-border bg-card p-5 shadow-sm"><SectionHeading index="03" title="Anchor to a standard" detail="This is what makes a field note traceable." /><div className="mt-5 grid gap-4 md:grid-cols-2"><TextField label="Standard reference" value={form.standardRef} onChange={(v) => update('standardRef', v)} placeholder="e.g. AS 3700:2018 cl. 4.9" testId="input-finding-standard-ref" /><TextField label="Standard title" value={form.standardTitle} onChange={(v) => update('standardTitle', v)} placeholder="Masonry structures" testId="input-finding-standard-title" /></div><div className="mt-4 grid gap-4 md:grid-cols-2"><TextAreaField label="Requirement" value={form.requirement} onChange={(v) => update('requirement', v)} placeholder="What does the standard require?" testId="textarea-finding-requirement" /><TextAreaField label="Tolerance / benchmark" value={form.tolerance} onChange={(v) => update('tolerance', v)} placeholder="What is acceptable?" testId="textarea-finding-tolerance" /></div><div className="mt-4 flex gap-2 rounded-md bg-[#EEE8D8] p-3 text-xs text-foreground/70"><Info size={15} className="mt-0.5 shrink-0 text-primary" /><span>If you cannot identify a standard on site, record the observation first and use the Standards library to finish the reference later.</span></div></section>
    <section className="rounded-lg border border-card-border bg-card p-5 shadow-sm"><SectionHeading index="04" title="Recommendations and photos" detail="Upload each image once, then choose whether it belongs in the client report or private evidence." /><div className="mt-5 space-y-4"><TextAreaField label="Recommendation" value={form.recommendation} onChange={(v) => update('recommendation', v)} placeholder="e.g. Engage a licensed builder to investigate movement and repair in accordance with the referenced requirement." testId="textarea-finding-recommendation" /><TextAreaField label="What this means for the client (optional)" value={form.clientExplanation} onChange={(v) => update('clientExplanation', v)} placeholder="Explain the issue without construction jargon." testId="textarea-finding-client-explanation" />{explanationWarnings.length > 0 && <div data-testid="client-explanation-advisory" aria-live="polite" className="rounded-md border border-[#D7A55A]/40 bg-[#D7A55A]/10 p-3 text-xs"><p className="font-semibold text-[#855B1B]">Consider simplifying this explanation</p><ul className="mt-1 space-y-1 text-[#855B1B]">{explanationWarnings.map((warning) => <li key={`${warning.kind}-${warning.term ?? warning.message}`}>{warning.message}</li>)}</ul><p className="mt-2 text-[11px] text-[#855B1B]/80">This is advisory. Review the wording yourself before saving.</p></div>}<div className="grid gap-4 md:grid-cols-2"><MediaPicker title="Include in client report" detail="Visible to the client after the report is ready." icon={<Camera size={15} className="text-primary" />} testId="input-report-photo-files" onChange={(files) => addMediaFiles(files, 'client_report')} /><MediaPicker title="Private evidence only" detail="Retained for inspectors and never exposed through the client report." icon={<Cloud size={15} className="text-primary" />} testId="input-evidence-photo-files" onChange={(files) => addMediaFiles(files, 'private_evidence')} /></div>{mediaDrafts.length > 0 && <div className="space-y-2 rounded-md bg-muted/55 p-3">{mediaDrafts.map((draft) => <div key={draft.id} className="flex items-center gap-3 text-xs"><span className="min-w-0 flex-1 truncate">{draft.file.name}</span><span className="text-muted-foreground">{draft.classification === 'client_report' ? 'Client report' : 'Private evidence'}</span><span className={draft.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}>{draft.status === 'queued' ? 'Ready' : draft.status === 'uploading' ? `${draft.progress}%` : draft.status === 'uploaded' ? 'Uploaded' : 'Needs retry'}</span>{draft.status === 'error' && savedFindingId && <button type="button" onClick={() => retryMedia(draft)} className="text-[11px] font-semibold text-primary hover:underline">Retry</button>}</div>)}</div> }<SelectField label="Evidence backup destination" value={form.backupDestination} onChange={(v) => update('backupDestination', v)} options={backupDestinations} testId="select-photo-backup" /><p className="rounded-md bg-muted/55 px-3 py-2 text-xs leading-relaxed text-muted-foreground">Only verified App Storage objects update the finding photo counts. Private evidence can never satisfy the client-report photo requirement.</p></div></section>
      {error && <p data-testid="text-finding-error" className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>}<div className="flex flex-col-reverse justify-between gap-3 sm:flex-row sm:items-center"><Link href={`/inspections/${id}`} data-testid="button-cancel-finding" className="btn-secondary text-center">Cancel</Link><button type="submit" disabled={mutation.isPending} data-testid="button-save-finding" className="btn-primary">{mutation.isPending ? 'Saving finding…' : 'Save finding'}<Save size={15} /></button></div></form>
   </div>;
}

function SectionHeading({ index, title, detail }: { index: string; title: string; detail: string }) { return <div className="flex gap-3"><span className="font-mono text-xs text-primary">{index}</span><div><h2 className="text-base font-semibold">{title}</h2><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div></div>; }
function TextField({ label, value, onChange, placeholder, testId }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; testId: string }) { return <label className="block"><span className="mb-1.5 block text-xs font-semibold">{label}</span><input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} data-testid={testId} className="field-input" /></label>; }
function TextAreaField({ label, value, onChange, placeholder, testId }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; testId: string }) { return <label className="block"><span className="mb-1.5 block text-xs font-semibold">{label}</span><textarea value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} data-testid={testId} className="field-input min-h-[92px] resize-y" /></label>; }
function MediaPicker({ title, detail, icon, testId, onChange }: { title: string; detail: string; icon: React.ReactNode; testId: string; onChange: (files: FileList | null) => void }) { return <label className="block cursor-pointer rounded-md border border-dashed border-border p-3 transition-colors hover:border-primary"><div className="mb-1 flex items-center gap-2 text-xs font-semibold">{icon}{title}</div><p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">{detail}</p><input type="file" accept="image/jpeg,image/png,image/webp" multiple className="block w-full text-xs text-muted-foreground file:mr-2 file:rounded file:border-0 file:bg-primary file:px-2 file:py-1 file:text-xs file:font-semibold file:text-primary-foreground" data-testid={testId} onChange={(event) => onChange(event.target.files)} /></label>; }
function SelectField({ label, value, onChange, options, testId }: { label: string; value: string; onChange: (value: string) => void; options: readonly string[]; testId: string }) { return <label className="block"><span className="mb-1.5 block text-xs font-semibold">{label}</span><div className="relative"><select value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} className="field-input appearance-none pr-9">{options.map((option) => <option value={option} key={option}>{option.replaceAll('_', ' ')}</option>)}</select><ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" /></div></label>; }