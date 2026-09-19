import { useMemo, useState, useEffect, useRef } from 'react';
import { useAuth } from '@clerk/react';
import { AlertTriangle, ArrowLeft, Camera, CheckCircle2, ChevronRight, Copy, CopyPlus, Edit3, FileCheck2, MapPin, Plus, RefreshCw, Save, Send, ShieldCheck, Trash2, UserRoundCheck } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { useGetInspection, useUpdateInspection, useUpdateFinding, useCreateFinding, getGetInspectionQueryKey, useGetReportReadiness, getGetReportReadinessQueryKey, useMarkReportReady, useShareReport, usePreviewReportTranslation, useRevokeReportLink, useRotateReportLink, useRecoverReportLink, useListReportDeliveryHistory, getListReportDeliveryHistoryQueryKey, useAssignInspection, useListWorkspaceInspectors, getListWorkspaceInspectorsQueryKey, useUpdateFindingMediaClassification, useDeleteFindingMedia, type WorkspaceInspector } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { AssessmentMark, ErrorState, LoadingRows, Measurement, SeverityBadge, StatusBadge, formatDate, titleCase } from '@/components/ui-pieces';
import { PotentialDefectLayer } from '@/components/potential-defect-layer';
import { reportLinkStateFromUrl } from './report-link-state';
import { reportInvalidationCopy } from './report-invalidation-copy';
import { refreshReportState } from './report-state-refresh';
import { isLastReportPhoto, reportPhotoManagementState } from './report-photo-management';
import { missingFindingLabel } from './report-readiness-copy';
import { deliveryEventActorLabel } from './delivery-event-actor';
import { SHARED_REPORT_EDIT_WARNING } from './shared-report-edit-warning';
import { PlainLanguageExplanationDialog, useEditWarningDialog } from './shared-report-edit-warning-dialog';
import { allTranslationsAccepted, discardTranslationReviewDraft, loadTranslationReviewDraft, mergeTranslationPreview, saveTranslationReviewDraft, translationSourceSignature, type TranslationReviewItem } from './report-translation-review';
import { WorkspaceUsageCard } from '@/components/workspace-usage-card';

const LEGACY_UNASSIGNED_OWNER = 'legacy_unassigned';

export function InspectionDetailPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const id = Number(params.id);
  const { sessionClaims } = useAuth();
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role;
  const isWorkspaceManager = role === 'manager' || role === 'admin';
  const query = useGetInspection(id, { query: { queryKey: getGetInspectionQueryKey(id), enabled: Number.isFinite(id), refetchInterval: 15000 } });
  const inspection = query.data;
  const inspectorsQuery = useListWorkspaceInspectors({ query: { enabled: isWorkspaceManager, queryKey: getListWorkspaceInspectorsQueryKey() } });
  const assignInspection = useAssignInspection();
  const updateInspection = useUpdateInspection();
  const [editingStatus, setEditingStatus] = useState(false);
  const [editFinding, setEditFinding] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [selectedOwnerId, setSelectedOwnerId] = useState('');
  const editWarning = useEditWarningDialog();
  const previousShareToken = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const current = inspection?.reportShareToken;
    if (previousShareToken.current && !current) {
      refreshReportState(queryClient, {
        inspection: getGetInspectionQueryKey(id),
        readiness: getGetReportReadinessQueryKey(id),
        history: getListReportDeliveryHistoryQueryKey(id),
      });
    }
    previousShareToken.current = current;
  }, [id, inspection?.reportShareToken, queryClient]);
  useEffect(() => {
    setSelectedOwnerId(
      inspection?.ownerId && inspection.ownerId !== LEGACY_UNASSIGNED_OWNER
        ? inspection.ownerId
        : '',
    );
  }, [inspection?.ownerId]);
  const findings = useMemo(() => inspection?.findings ?? [], [inspection?.findings]);
  if (query.isLoading) return <LoadingRows count={5} />;
  if (query.isError || !inspection) return <ErrorState retry={() => query.refetch()} />;
  const progress = Math.min(100, inspection.status === 'complete' ? 100 : inspection.findingsCount ? 58 : 24);
  const highRisk = findings.filter((finding) => finding.severity === 'critical' || finding.severity === 'high').length;
  const visibleFindings = showAll ? findings : findings.slice(0, 4);
  const setStatus = (status: 'draft' | 'in_progress' | 'complete', trigger: HTMLElement | null) => {
    editWarning.openSharedReportWarning({
      hasActiveLink: Boolean(inspection.reportShareToken),
      trigger,
      description: SHARED_REPORT_EDIT_WARNING,
      onConfirm: () => updateInspection.mutate({ id, data: { status } }, { onSuccess: () => { setEditingStatus(false); queryClient.invalidateQueries({ queryKey: getGetInspectionQueryKey(id) }); } }),
    });
  };
  return <div className="animate-rise-in space-y-6">
     {editWarning.dialog}
    <div className="flex items-center gap-2 text-xs text-muted-foreground"><Link href="/inspections" data-testid="link-back-inspections" className="inline-flex items-center gap-1 hover:text-foreground"><ArrowLeft size={14} /> Inspections</Link><ChevronRight size={13} /><span className="truncate">{inspection.title}</span></div>
     <section className="flex flex-col justify-between gap-5 border-b border-border pb-6 lg:flex-row lg:items-end"><div><div className="flex flex-wrap items-center gap-2"><StatusBadge status={inspection.status} /><span className="rounded-full border border-primary/15 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">{titleCase(inspection.reportType)}</span><span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">SC-{String(id).padStart(4, '0')}</span></div><h1 data-testid="text-inspection-title" className="mt-3 text-3xl font-semibold tracking-[-.04em]">{inspection.title}</h1><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground"><span className="inline-flex items-center gap-1.5"><MapPin size={14} />{inspection.propertyAddress}</span><span>{inspection.clientName}</span><span>{formatDate(inspection.inspectionDate)}</span></div></div><div className="flex gap-2"><Link href={`/inspections/${id}/scan`} data-testid="button-camera-scan" className="btn-secondary text-primary"><Camera size={16} /> Scan condition</Link><Link href={`/inspections/${id}/findings/new`} data-testid="button-add-finding" className="btn-primary"><Plus size={16} /> Add finding</Link><button onClick={() => setEditingStatus(!editingStatus)} data-testid="button-update-inspection-status" className="btn-secondary">{editingStatus ? 'Close' : 'Update status'}</button>{editingStatus && <div className="absolute mt-11 mr-0 flex flex-col overflow-hidden rounded-md border border-border bg-card p-1 shadow-lg"><button onClick={(event) => setStatus('draft', event.currentTarget)} data-testid="button-status-draft" className="px-3 py-2 text-left text-xs hover:bg-muted">Mark draft</button><button onClick={(event) => setStatus('in_progress', event.currentTarget)} data-testid="button-status-in-progress" className="px-3 py-2 text-left text-xs hover:bg-muted">Mark in progress</button><button onClick={(event) => setStatus('complete', event.currentTarget)} data-testid="button-status-complete" className="px-3 py-2 text-left text-xs hover:bg-muted">Mark complete</button></div>}</div></section>
     {inspection.reportType === 'insurance_assessment' && <section data-testid="insurance-output-pathway" className="rounded-lg border border-[#365552] bg-[#254541] p-4 text-[#F5F0E5]"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><div className="eyebrow text-[#BBD1C7]">Insurance pathway</div><h2 className="mt-1 text-base font-semibold">Assessment report and scope of works</h2><p className="mt-1 text-xs text-[#BBD1C7]">Keep the damage assessment separate from the recommended repair scope.</p></div><div className="flex gap-2 text-xs"><span className="rounded border border-[#BBD1C7]/30 px-3 py-2">Assessment report</span><span className="rounded border border-[#BBD1C7]/30 px-3 py-2">Scope of works</span></div></div></section>}
      {isWorkspaceManager && <InspectionAssignmentPanel
        inspection={inspection}
        inspectors={inspectorsQuery.data ?? []}
        inspectorsLoading={inspectorsQuery.isLoading}
        selectedOwnerId={selectedOwnerId}
        onOwnerChange={setSelectedOwnerId}
        mutation={assignInspection}
        onAssigned={() => {
          queryClient.invalidateQueries({ queryKey: getGetInspectionQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListWorkspaceInspectorsQueryKey() });
          refreshReportState(queryClient, {
            inspection: getGetInspectionQueryKey(id),
            readiness: getGetReportReadinessQueryKey(id),
            history: getListReportDeliveryHistoryQueryKey(id),
          });
        }}
      />}
    <section className="grid gap-3 md:grid-cols-3"><ProgressCard label="Inspection progress" value={`${progress}%`} detail={progress === 100 ? 'Report-ready state' : 'Evidence collection underway'} progress={progress} /><ProgressCard label="Findings recorded" value={String(inspection.findingsCount)} detail={`${highRisk} high-risk items`} /><ProgressCard label="Photos attached" value={String(findings.reduce((sum, finding) => sum + finding.photosCount, 0))} detail="Across all findings" /></section>
    <PotentialDefectLayer inspectionId={id} />
    <ReportDeliveryPanel inspection={inspection} />
     <section className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]"><div className="rounded-lg border border-card-border bg-card p-5 shadow-sm"><div className="mb-4 flex items-end justify-between"><div><div className="eyebrow">Evidence register</div><h2 className="mt-1 text-lg font-semibold">Findings</h2></div><span className="font-mono text-[10px] text-muted-foreground">{findings.length} total</span></div>{findings.length ? <div className="space-y-3">{visibleFindings.map((finding) => <FindingCard key={finding.id} finding={finding} hasActiveSharedReport={Boolean(inspection.reportShareToken)} editing={editFinding === finding.id} onEdit={() => setEditFinding(editFinding === finding.id ? null : finding.id)} onSaved={() => { setEditFinding(null); queryClient.invalidateQueries({ queryKey: getGetInspectionQueryKey(id) }); refreshReportState(queryClient, { inspection: getGetInspectionQueryKey(id), readiness: getGetReportReadinessQueryKey(id), history: getListReportDeliveryHistoryQueryKey(id) }); }} />)}{findings.length > 4 && <button onClick={() => setShowAll(!showAll)} data-testid="button-toggle-findings" className="w-full border-t border-border pt-3 text-xs font-semibold text-primary hover:underline">{showAll ? 'Show fewer findings' : `Show all ${findings.length} findings`}</button>}</div> : <div className="py-8 text-center"><FileCheck2 size={24} className="mx-auto text-muted-foreground" /><p className="mt-2 text-sm font-medium">No findings recorded</p><div className="mt-2 flex items-center justify-center gap-3"><Link href={`/inspections/${id}/scan`} data-testid="link-first-scan" className="inline-block text-xs font-semibold text-primary hover:underline">Camera scan</Link><span className="text-xs text-muted-foreground">•</span><Link href={`/inspections/${id}/findings/new`} data-testid="link-first-finding" className="inline-block text-xs font-semibold text-primary hover:underline">Manual entry</Link></div></div>}</div>
      <div className="space-y-5"><div className="rounded-lg border border-card-border bg-card p-5 shadow-sm"><div className="eyebrow">Standards context</div><h2 className="mt-1 text-lg font-semibold">Traceability check</h2><div className="mt-5 space-y-3"><SummaryLine icon={ShieldCheck} label="Standards referenced" value={`${findings.filter((f) => f.standardRef).length} / ${findings.length || 0}`} /><SummaryLine icon={Camera} label="With photo evidence" value={`${findings.filter((f) => f.photosCount > 0).length} / ${findings.length || 0}`} /><SummaryLine icon={CheckCircle2} label="Recommendations written" value={`${findings.filter((f) => f.recommendation).length} / ${findings.length || 0}`} /></div></div><AiPreferenceCard /><div className="rounded-lg border border-[#365552] bg-[#254541] p-5 text-[#F5F0E5]"><div className="eyebrow text-[#BBD1C7]">Report readiness</div><div className="mt-2 flex items-center gap-2 text-lg font-semibold"><span className={`status-dot ${progress === 100 ? 'bg-[#8AB8A6]' : 'bg-[#E0A26A]'}`} />{progress === 100 ? 'Ready to send' : 'Still in progress'}</div><p className="mt-2 text-xs leading-relaxed text-[#BBD1C7]">{progress === 100 ? 'All required inspection evidence is present.' : 'Complete the evidence trail before generating a report.'}</p></div></div></section>
  </div>;
}

function ReportDeliveryPanel({ inspection }: { inspection: import('@workspace/api-client-react').InspectionDetail }) {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const editWarning = useEditWarningDialog();
  const readiness = useGetReportReadiness(inspection.id, { query: { queryKey: getGetReportReadinessQueryKey(inspection.id) } });
  const markReady = useMarkReportReady();
  const share = useShareReport();
  const translationPreview = usePreviewReportTranslation();
  const revoke = useRevokeReportLink();
  const rotate = useRotateReportLink();
  const recover = useRecoverReportLink();
  const updateFinding = useUpdateFinding();
  const saveContact = useUpdateInspection();
  
  const history = useListReportDeliveryHistory(inspection.id, { 
    query: { queryKey: getListReportDeliveryHistoryQueryKey(inspection.id) } 
  });

  const [recipientType, setRecipientType] = useState<'client' | 'agent'>(inspection.reportRecipientType ?? 'client');
  const selectedSavedEmail = recipientType === 'client' ? inspection.clientEmail : inspection.agentEmail;
  const selectedReportLanguage = inspection.reportSummaryLanguage === 'zh-Hans'
    || inspection.reportSummaryLanguage === 'vi'
    || inspection.reportSummaryLanguage === 'ar'
    ? inspection.reportSummaryLanguage
    : 'en';
  const [recipientEmail, setRecipientEmail] = useState(selectedSavedEmail ?? '');
  const [summaryLanguage, setSummaryLanguage] = useState<'en' | 'zh-Hans' | 'vi' | 'ar'>(selectedReportLanguage);
  const translationSource = translationSourceSignature(inspection.findings);
  const translationDraftIdentity = `${userId ?? ''}:${inspection.id}:${summaryLanguage}:${translationSource}`;
  const [translationDraft, setTranslationDraft] = useState(() => ({
    identity: translationDraftIdentity,
    items: typeof window === 'undefined'
      ? []
      : userId
        ? loadTranslationReviewDraft(
            window.localStorage,
            userId,
            inspection.id,
            summaryLanguage,
            translationSource,
          )
        : [],
  }));
  const [explanationRequest, setExplanationRequest] = useState<{
    finding: { id: number; title: string };
    trigger: HTMLElement | null;
  } | null>(null);
  const [explanationDraft, setExplanationDraft] = useState('');
  const [explanationError, setExplanationError] = useState<string | null>(null);
  const translationReview = translationDraft.identity === translationDraftIdentity
    ? translationDraft.items
    : [];
  const hasUsableLink = Boolean(inspection.reportShareToken && inspection.deliveryStatus !== 'failed' && inspection.deliveryStatus !== 'sending');
  const hasInvalidatedLink = Boolean(
    inspection.reportStatus === 'draft'
      && !inspection.reportShareToken
      && inspection.reportRecipientEmail,
  );
  const [linkState, setLinkState] = useState(() => reportLinkStateFromUrl(
    hasUsableLink ? `/reports/${inspection.reportShareToken}` : null,
  ));

  useEffect(() => {
    setLinkState(reportLinkStateFromUrl(
      hasUsableLink ? `/reports/${inspection.reportShareToken}` : null,
    ));
  }, [hasUsableLink, inspection.reportShareToken]);
  useEffect(() => {
    setRecipientEmail(selectedSavedEmail ?? '');
  }, [selectedSavedEmail]);
  useEffect(() => {
    if (summaryLanguage === selectedReportLanguage) return;
    if (typeof window !== 'undefined') {
      if (userId) discardTranslationReviewDraft(window.localStorage, userId, inspection.id, summaryLanguage);
    }
    setSummaryLanguage(selectedReportLanguage);
  }, [inspection.id, selectedReportLanguage, summaryLanguage, userId]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setTranslationDraft({
      identity: translationDraftIdentity,
      items: userId
        ? loadTranslationReviewDraft(
            window.localStorage,
            userId,
            inspection.id,
            summaryLanguage,
            translationSource,
          )
        : [],
    });
  }, [inspection.id, summaryLanguage, translationDraftIdentity, translationSource, userId]);
  useEffect(() => {
    if (
      typeof window === 'undefined'
      || !userId
      || translationDraft.identity !== translationDraftIdentity
    ) return;
    saveTranslationReviewDraft(
      window.localStorage,
      userId,
      inspection.id,
      summaryLanguage,
      translationSource,
      translationDraft.items,
    );
  }, [inspection.id, summaryLanguage, translationDraft, translationDraftIdentity, translationSource, userId]);

  const refresh = () => {
    refreshReportState(queryClient, {
      inspection: getGetInspectionQueryKey(inspection.id),
      readiness: getGetReportReadinessQueryKey(inspection.id),
      history: getListReportDeliveryHistoryQueryKey(inspection.id),
    });
  };

  const copyLink = async () => {
    if (!linkState.shareUrl) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}${linkState.shareUrl}`);
    } catch (e) {
      // ignore
    }
  };
  const chooseRecipient = (type: 'client' | 'agent') => {
    setRecipientType(type);
    setRecipientEmail((type === 'client' ? inspection.clientEmail : inspection.agentEmail) ?? '');
  };
  const chooseSummaryLanguage = (language: typeof summaryLanguage) => {
    if (language === summaryLanguage) return;
    if (typeof window !== 'undefined') {
      if (userId) discardTranslationReviewDraft(window.localStorage, userId, inspection.id, summaryLanguage);
    }
    setSummaryLanguage(language);
  };
  const saveRecipient = () => saveContact.mutate(
    { id: inspection.id, data: recipientType === 'client' ? { clientEmail: recipientEmail } : { agentEmail: recipientEmail } },
    { onSuccess: refresh },
  );
  const wasAttempted = Boolean(inspection.reportDeliveryAttemptedAt);
  const deliveryButtonLabel = hasInvalidatedLink && !linkState.shareUrl
    ? 'Resend replacement link'
    : inspection.deliveryStatus === 'failed'
      ? 'Retry email'
      : wasAttempted ? 'Send again' : 'Email report';
  const translationReviewComplete = summaryLanguage === 'en' || allTranslationsAccepted(translationReview);

  const previewTranslation = (findingId?: number) => {
    translationPreview.mutate(
      { id: inspection.id, data: { summaryLanguage, ...(findingId ? { findingId } : {}) } },
      {
        onSuccess: (preview) => {
          setTranslationDraft((current) => ({
            identity: translationDraftIdentity,
            items: mergeTranslationPreview(
              current.identity === translationDraftIdentity ? current.items : [],
              preview.translations,
              findingId,
            ),
          }));
        },
      },
    );
  };
  const updateTranslationText = (id: number, text: string) => {
    setTranslationDraft((current) => ({
      identity: translationDraftIdentity,
      items: (current.identity === translationDraftIdentity ? current.items : [])
        .map((item) => item.id === id ? { ...item, text, accepted: false } : item),
    }));
  };
  const toggleTranslationAccepted = (id: number) => {
    setTranslationDraft((current) => ({
      identity: translationDraftIdentity,
      items: (current.identity === translationDraftIdentity ? current.items : [])
        .map((item) => item.id === id ? { ...item, accepted: !item.accepted } : item),
    }));
  };
  const recoverLink = () => {
    recover.mutate(
      { id: inspection.id },
      {
        onSuccess: (action) => {
          setLinkState(reportLinkStateFromUrl(action.shareUrl));
          refresh();
        },
      },
    );
  };

  const handleRevoke = (trigger: HTMLElement | null) => {
    if (!linkState.currentShareToken) return;
    editWarning.open({
      title: 'Revoke client link?',
      description: "The old link will stop working immediately, but the report will remain in the 'ready' state.",
      trigger,
      onConfirm: () => revoke.mutate({ id: inspection.id, data: { currentShareToken: linkState.currentShareToken! } }, { onSuccess: () => { setLinkState(reportLinkStateFromUrl(null)); refresh(); } }),
    });
  };

  const handleRotate = (trigger: HTMLElement | null) => {
    if (!linkState.currentShareToken) return;
    editWarning.open({
      title: 'Replace client link?',
      description: 'The old link will stop working immediately, and a new replacement link will be generated.',
      trigger,
      onConfirm: () => rotate.mutate({ id: inspection.id, data: { currentShareToken: linkState.currentShareToken! } }, { onSuccess: (action) => { setLinkState(reportLinkStateFromUrl(action.shareUrl)); refresh(); } }),
    });
  };

  const addPlainExplanation = (finding: { id: number; title: string }, trigger: HTMLElement | null) => {
    editWarning.openSharedReportWarning({
      hasActiveLink: Boolean(inspection.reportShareToken),
      trigger,
      description: SHARED_REPORT_EDIT_WARNING,
      restoreFocus: false,
      onConfirm: () => {
        setExplanationDraft('');
        setExplanationError(null);
        setExplanationRequest({ finding, trigger });
      },
    });
  };

  const closeExplanationDialog = () => {
    if (updateFinding.isPending) return;
    setExplanationRequest(null);
    setExplanationDraft('');
    setExplanationError(null);
  };

  const savePlainExplanation = () => {
    const explanation = explanationDraft.trim();
    if (!explanationRequest || !explanation) return;
    setExplanationError(null);
    updateFinding.mutate(
      {
        id: explanationRequest.finding.id,
        data: { clientExplanation: explanation },
      },
      {
        onSuccess: () => {
          refresh();
          setExplanationRequest(null);
          setExplanationDraft('');
        },
        onError: () => setExplanationError('Could not save this explanation. Check the connection and try again.'),
      },
    );
  };

  const formatDateTime = (value?: string) => value ? new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : '—';

  return <section data-testid="report-delivery-panel" className="rounded-lg border border-card-border bg-card p-5 shadow-sm">
    <PlainLanguageExplanationDialog
      open={Boolean(explanationRequest)}
      findingTitle={explanationRequest?.finding.title ?? ''}
      value={explanationDraft}
      trigger={explanationRequest?.trigger ?? null}
      saving={updateFinding.isPending}
      error={explanationError}
      onValueChange={setExplanationDraft}
      onCancel={closeExplanationDialog}
      onSave={savePlainExplanation}
    />
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
      <div>
        <div className="eyebrow">Client delivery</div>
        <h2 className="mt-1 text-lg font-semibold">Interactive report & PDF</h2>
        <p className="mt-1 text-xs text-muted-foreground">Complete the checks, mark the report ready, then share one client-safe report link.</p>
      </div>
      <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
        {titleCase(inspection.deliveryStatus)}
      </span>
    </div>
    <div className="mt-5"><WorkspaceUsageCard compact /></div>
    
    <div className="mt-5 grid gap-5 lg:grid-cols-3">
      {/* 1. Readiness */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold">Completion checks</span>
          <span className="font-mono text-muted-foreground">{readiness.data ? `${readiness.data.completedCount}/${readiness.data.totalCount}` : '—'}</span>
        </div>
        <div className="space-y-2">
          {readiness.data?.checks.map((check) => (
            <div key={check.key} className="flex gap-3 rounded-md border border-border/70 p-3">
              <CheckCircle2 size={16} className={check.complete ? 'text-primary' : 'text-muted-foreground/45'} />
              <div>
                <p className="text-xs font-semibold">{check.label}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{check.detail}</p>
                 {check.missingFindings.length > 0 && <ul className="mt-2 space-y-1">{check.missingFindings.map((finding) => <li key={finding.id}><button type="button" onClick={(event) => addPlainExplanation(finding, event.currentTarget)} disabled={updateFinding.isPending} className="text-left text-[11px] font-medium text-primary hover:underline">{missingFindingLabel(finding)} — add explanation</button></li>)}</ul>}
                {check.key === 'client_explanations_complete' && readiness.data?.advisories.length ? <div data-testid="client-explanation-readiness-advisories" className="mt-3 rounded-md border border-[#D7A55A]/40 bg-[#D7A55A]/10 p-2.5 text-[#855B1B]"><p className="flex items-center gap-1.5 text-[11px] font-semibold"><AlertTriangle size={13} />Some explanations may need simplification</p><ul className="mt-1 space-y-1 text-[11px]">{readiness.data.advisories.map((advisory) => <li key={advisory.id}><span className="font-medium">{missingFindingLabel(advisory)}</span><ul className="ml-3 list-disc">{advisory.warnings.map((warning) => <li key={`${warning.kind}-${warning.term ?? warning.message}`}>{warning.message}</li>)}</ul></li>)}</ul><p className="mt-2 text-[10px]">Advisory only — this does not block report readiness.</p></div> : null}
              </div>
            </div>
          ))}
        </div>
        {inspection.reportStatus !== 'ready' && (
          <button disabled={!readiness.data?.ready || markReady.isPending} onClick={() => markReady.mutate({ id: inspection.id }, { onSuccess: refresh })} className="btn-primary mt-auto">
            <FileCheck2 size={15} />Mark report ready
          </button>
        )}
      </div>

      {/* 2. Recipient, delivery, and active link */}
      <div className="flex flex-col rounded-md bg-muted/45 p-4">
        <p className="mb-3 text-xs font-semibold">Report access</p>
        {hasInvalidatedLink && !linkState.shareUrl ? (
          <div className="mb-3 rounded-md border border-[#D7A55A]/50 bg-[#D7A55A]/10 p-3" data-testid="invalidated-report-link">
            <p className="text-[11px] font-semibold text-[#855B1B]">Previous client link invalidated</p>
            <p className="mt-1 text-[10px] leading-relaxed text-[#855B1B]">
              The old URL no longer works after an inspection change. Generate a replacement link to copy or resend; the old URL will not be shown again.
            </p>
            {history.data?.find((event) => event.eventType === 'automatically_invalidated')?.reason && <p className="mt-2 text-[10px] text-[#855B1B]">
              {reportInvalidationCopy[history.data.find((event) => event.eventType === 'automatically_invalidated')?.reason as keyof typeof reportInvalidationCopy] ?? 'The report was changed.'}
            </p>}
            <button
              type="button"
              onClick={recoverLink}
              disabled={!readiness.data?.ready || recover.isPending}
              className="btn-secondary mt-3 w-full justify-center text-[11px]"
              data-testid="button-recover-report-link"
            >
              {recover.isPending ? 'Generating replacement…' : readiness.data?.ready ? 'Generate replacement link' : 'Complete checks to recover link'}
            </button>
            {recover.isError && <p className="mt-2 text-[10px] text-destructive">Could not generate a replacement link. Refresh and try again.</p>}
          </div>
        ) : !linkState.shareUrl ? (
          <p className="mb-3 rounded-md border border-border/70 bg-background/50 px-3 py-2 text-[10px] text-muted-foreground" data-testid="no-shared-report-link">
            No client link has been shared yet.
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => chooseRecipient('client')} className={recipientType === 'client' ? 'btn-primary' : 'btn-secondary'} data-testid="button-recipient-client">Client</button>
          <button onClick={() => chooseRecipient('agent')} className={recipientType === 'agent' ? 'btn-primary' : 'btn-secondary'} data-testid="button-recipient-agent">Agent</button>
        </div>
        <div className="mt-3 flex gap-2">
          <input type="email" value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)} placeholder={`${recipientType}@example.com`} className="field-input" data-testid="input-recipient-email" />
          <button disabled={!recipientEmail || recipientEmail === selectedSavedEmail || saveContact.isPending} onClick={saveRecipient} className="btn-secondary shrink-0" data-testid="button-save-recipient">{saveContact.isPending ? 'Saving…' : 'Save'}</button>
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground">Reports can only be emailed to an address saved on this inspection.</p>
        <label className="mt-3 text-[11px] font-semibold text-foreground/80">Client summary language
          <select value={summaryLanguage} onChange={(event) => chooseSummaryLanguage(event.target.value as typeof summaryLanguage)} className="field-input mt-1" data-testid="select-summary-language">
            <option value="en">English</option>
            <option value="zh-Hans">简体中文 (Simplified Chinese)</option>
            <option value="vi">Tiếng Việt (Vietnamese)</option>
            <option value="ar">العربية (Arabic)</option>
          </select>
        </label>
         <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">Only the approved plain-language summary is translated. Professional findings, recommendations, and Standards references remain in English.</p>
         {summaryLanguage !== 'en' && <div className="mt-3 rounded-md border border-primary/20 bg-primary/5 p-3">
           <div className="flex items-center justify-between gap-2">
             <div>
               <p className="text-[11px] font-semibold">Translation review</p>
               <p className="mt-0.5 text-[10px] text-muted-foreground">{translationReview.length ? `${translationReview.filter((item) => item.accepted).length}/${translationReview.length} explanations accepted` : 'Preview the client wording before delivery.'}</p>
             </div>
             <button type="button" onClick={() => previewTranslation()} disabled={translationPreview.isPending || inspection.reportStatus !== 'ready'} className="btn-secondary px-2.5 py-1.5 text-[10px]" data-testid="button-preview-translation">
               <RefreshCw size={12} />{translationPreview.isPending ? 'Generating…' : translationReview.length ? 'Regenerate all' : 'Preview translation'}
             </button>
           </div>
           {translationReview.length > 0 && <div className="mt-3 space-y-3">
             {translationReview.map((translation) => <div key={translation.id} className="rounded border border-border bg-background p-2.5">
               <div className="flex items-start justify-between gap-2">
                 <div><p className="text-[11px] font-semibold">{translation.title}</p><p className="mt-1 text-[10px] text-muted-foreground">English authority: {translation.sourceText}</p></div>
                 <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold ${translation.accepted ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>{translation.accepted ? 'Accepted' : 'Review needed'}</span>
               </div>
               <textarea value={translation.text} onChange={(event) => updateTranslationText(translation.id, event.target.value)} aria-label={`Translated explanation for ${translation.title}`} className="field-input mt-2 min-h-[64px] resize-y text-[11px]" />
               <div className="mt-2 flex justify-end gap-2">
                 <button type="button" onClick={() => previewTranslation(translation.id)} disabled={translationPreview.isPending} className="text-[10px] font-semibold text-muted-foreground hover:text-primary">Regenerate</button>
                 <button type="button" onClick={() => toggleTranslationAccepted(translation.id)} className="text-[10px] font-semibold text-primary hover:underline">{translation.accepted ? 'Unaccept' : 'Accept wording'}</button>
               </div>
             </div>)}
           </div>}
           {translationPreview.isError && <p className="mt-2 text-[10px] text-destructive">Could not generate the translation preview. Nothing has been shared.</p>}
           {translationReview.length > 0 && !translationReviewComplete && <p className="mt-2 text-[10px] text-[#855B1B]">Accept each explanation after checking or editing it before sending.</p>}
         </div>}
        {inspection.deliveryStatus === 'failed' && <div className="mt-3 flex gap-2 rounded-md border border-destructive/20 bg-destructive/5 p-3 text-[11px] text-destructive"><AlertTriangle size={15} className="shrink-0" /><div><p className="font-semibold">Email was not delivered</p><p className="mt-0.5">{inspection.reportDeliveryError ?? 'The provider rejected the message. Check the saved address and retry.'}</p></div></div>}
         <button disabled={inspection.reportStatus !== 'ready' || !selectedSavedEmail || !translationReviewComplete || share.isPending || saveContact.isPending} onClick={() => share.mutate({ id: inspection.id, data: { recipientType, summaryLanguage, ...(summaryLanguage === 'en' ? {} : { reviewedTranslations: translationReview.map(({ id, text }) => ({ id, text: text.trim() })) }) } }, { onSuccess: (delivery) => { setLinkState(reportLinkStateFromUrl(delivery.deliveryStatus === 'failed' ? null : delivery.shareUrl)); refresh(); } })} className="btn-primary mt-3 w-full" data-testid="button-share-report">
          {inspection.deliveryStatus === 'failed' ? <RefreshCw size={15} /> : <Send size={15} />}{share.isPending ? 'Sending…' : deliveryButtonLabel}
        </button>
        {share.isError && <p className="mt-2 text-[10px] text-destructive">Failed to send report.</p>}
        {wasAttempted && <div className="mt-3 space-y-1 text-[11px] text-muted-foreground"><p>To: <span className="font-medium text-foreground">{inspection.reportRecipientEmail}</span></p><p>{inspection.reportViewedAt ? `Viewed ${formatDateTime(inspection.reportViewedAt)}` : inspection.reportDeliveredAt ? `Delivered ${formatDateTime(inspection.reportDeliveredAt)}` : inspection.reportSharedAt ? `Sent ${formatDateTime(inspection.reportSharedAt)}` : `Attempted ${formatDateTime(inspection.reportDeliveryAttemptedAt ?? undefined)}`}</p></div>}
        {linkState.shareUrl && <div className="mt-3 rounded border border-border bg-background p-3 text-xs">
          <p className="mb-1 font-semibold text-primary">Active share link</p>
          <div className="flex items-center gap-2"><input type="text" readOnly value={`${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}${linkState.shareUrl}`} className="field-input flex-1 bg-muted/30 text-[10px]" /><button onClick={copyLink} className="btn-secondary px-2" aria-label="Copy report link" data-testid="button-copy-link"><Copy size={14} /></button></div>
          <Link href={`${linkState.shareUrl}?preview=1`} target="_blank" className="btn-secondary mt-3 w-full justify-center" data-testid="link-open-report">Preview report</Link>
          <p className="mt-3 text-[10px] text-muted-foreground">Summary language: <span className="font-semibold">{summaryLanguageLabel(inspection.reportSummaryLanguage)}</span></p>
           <div className="mt-3 grid grid-cols-2 gap-2"><button onClick={(event) => handleRotate(event.currentTarget)} disabled={rotate.isPending || revoke.isPending} className="btn-secondary text-xs" data-testid="button-rotate-link">{rotate.isPending ? 'Replacing...' : 'Replace link'}</button><button onClick={(event) => handleRevoke(event.currentTarget)} disabled={revoke.isPending || rotate.isPending} className="btn-secondary text-xs text-destructive hover:bg-destructive/10" data-testid="button-revoke-link">{revoke.isPending ? 'Revoking...' : 'Revoke access'}</button></div>
          {revoke.isError && <p className="mt-2 text-[10px] text-destructive">Failed to revoke link.</p>}
          {rotate.isError && <p className="mt-2 text-[10px] text-destructive">Failed to replace link.</p>}
        </div>}
      </div>

      {/* 3. Security History */}
      <div className="rounded-md border border-border bg-card p-4 flex flex-col max-h-[350px]">
        <div className="flex items-center gap-2 mb-3 text-xs">
          <ShieldCheck size={14} className="text-primary" />
          <span className="font-semibold">Security History</span>
        </div>
        <div className="flex-1 overflow-y-auto pr-2 space-y-3">
           {history.isLoading ? (
             <div className="space-y-3">
               <div className="h-10 w-full animate-pulse rounded bg-muted"></div>
               <div className="h-10 w-full animate-pulse rounded bg-muted"></div>
             </div>
           ) : history.isError ? (
             <p className="text-[11px] text-destructive">Failed to load history</p>
           ) : history.data && history.data.length > 0 ? (
             history.data.map(event => (
               <div key={event.id} data-testid={`history-event-${event.id}`} className="flex flex-col gap-1 border-b border-border/50 pb-2 last:border-0 last:pb-0">
                 <div className="flex justify-between items-center text-[11px]">
                   <span className="font-semibold text-foreground/80">{titleCase(event.eventType)}</span>
                   <span className="text-muted-foreground">{formatDateTime(event.createdAt)}</span>
                 </div>
                 {event.recipientEmail && (
                   <div className="text-[10px] text-muted-foreground">
                     {titleCase(event.recipientType || '')}: {event.recipientEmail}
                   </div>
                 )}
                  {event.eventType === 'translation_reviewed' && event.reviewedSummaryLanguage && (
                    <div className="text-[10px] text-muted-foreground" data-testid={`history-translation-review-${event.id}`}>
                      {summaryLanguageLabel(event.reviewedSummaryLanguage)} summary reviewed
                      {event.reviewCompletedAt ? ` ${formatDateTime(event.reviewCompletedAt)}` : ''}
                    </div>
                  )}
                  <div className="text-[10px] font-medium text-foreground/70" data-testid={`history-actor-${event.id}`}>
                    {deliveryEventActorLabel(event)}
                  </div>
                  {event.reason && <div className="text-[10px] text-muted-foreground" data-testid={`history-reason-${event.id}`}>
                    {reportInvalidationCopy[event.reason as keyof typeof reportInvalidationCopy] ?? event.reason}
                  </div>}
               </div>
             ))
           ) : (
             <p className="text-[11px] text-muted-foreground">No security events yet.</p>
           )}
        </div>
      </div>
    </div>
     {editWarning.dialog}
  </section>;
}

function summaryLanguageLabel(language?: string | null) {
  if (language === 'zh-Hans') return 'Simplified Chinese';
  if (language === 'vi') return 'Vietnamese';
  if (language === 'ar') return 'Arabic';
  return 'English';
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function InspectionAssignmentPanel({
  inspection,
  inspectors,
  inspectorsLoading,
  selectedOwnerId,
  onOwnerChange,
  mutation,
  onAssigned,
}: {
  inspection: import('@workspace/api-client-react').InspectionDetail;
  inspectors: WorkspaceInspector[];
  inspectorsLoading: boolean;
  selectedOwnerId: string;
  onOwnerChange: (ownerId: string) => void;
  mutation: ReturnType<typeof useAssignInspection>;
  onAssigned: () => void;
}) {
  const editWarning = useEditWarningDialog();
  const currentOwner = inspectors.find((inspector) => inspector.id === inspection.ownerId);
  const selectedOwner = inspectors.find((inspector) => inspector.id === selectedOwnerId);
  const assign = (trigger: HTMLElement | null) => {
    if (!selectedOwnerId || selectedOwnerId === inspection.ownerId) return;
    const linkWarning = inspection.reportShareToken
      ? '\n\nThis inspection has an active client link. Reassigning it will revoke that link and reset report delivery to draft.'
      : '';
    editWarning.open({
      title: 'Save inspection assignment?',
      description: `Assign this inspection to ${selectedOwner?.displayName ?? 'the selected inspector'}?${linkWarning}`,
      trigger,
      onConfirm: () => mutation.mutate(
        { id: inspection.id, data: { ownerId: selectedOwnerId } },
        { onSuccess: onAssigned },
      ),
    });
  };

  return <section data-testid="inspection-assignment-panel" className="rounded-lg border border-primary/20 bg-primary/5 p-5">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
      <div>
        <div className="eyebrow text-primary">Manager controls</div>
        <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold"><UserRoundCheck size={18} className="text-primary" /> Inspection assignment</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Assigning this record changes who can access its field evidence. Active client links are revoked when ownership changes.
        </p>
      </div>
      <span className="rounded-full border border-primary/20 bg-background px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
        {inspection.ownerId === LEGACY_UNASSIGNED_OWNER ? 'Legacy unassigned' : (currentOwner?.displayName ?? 'Assigned')}
      </span>
    </div>
    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className="block flex-1">
        <span className="mb-1.5 block text-xs font-semibold">Assign to inspector</span>
        <select
          value={selectedOwnerId}
          onChange={(event) => onOwnerChange(event.target.value)}
          disabled={inspectorsLoading || mutation.isPending}
          data-testid="select-inspection-owner"
          className="field-input"
        >
          <option value="">{inspectorsLoading ? 'Loading inspectors…' : 'Choose an inspector'}</option>
          {inspectors.map((inspector) => (
            <option key={inspector.id} value={inspector.id}>
              {inspector.displayName}{inspector.email ? ` · ${inspector.email}` : ''}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
         onClick={(event) => assign(event.currentTarget)}
        disabled={!selectedOwnerId || selectedOwnerId === inspection.ownerId || mutation.isPending}
        data-testid="button-assign-inspection"
        className="btn-primary whitespace-nowrap"
      >
        <UserRoundCheck size={15} />{mutation.isPending ? 'Assigning…' : 'Save assignment'}
      </button>
    </div>
    {mutation.isError && <p data-testid="text-assignment-error" className="mt-2 text-xs text-destructive">Could not update ownership. Refresh and try again.</p>}
     {inspection.ownerId === LEGACY_UNASSIGNED_OWNER && <p className="mt-3 text-[11px] text-muted-foreground">This is a legacy record without an owner. Assigning it completes the audited migration step.</p>}
     {editWarning.dialog}
  </section>;
}

function ProgressCard({ label, value, detail, progress }: { label: string; value: string; detail: string; progress?: number }) { return <div className="rounded-lg border border-card-border bg-card p-4 shadow-sm"><div className="eyebrow">{label}</div><div className="mt-3 flex items-end justify-between"><span className="font-mono text-2xl">{value}</span><span className="text-right text-[11px] text-muted-foreground">{detail}</span></div>{progress !== undefined && <div className="mt-3 h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div>}</div>; }
function SummaryLine({ icon: Icon, label, value }: { icon: typeof ShieldCheck; label: string; value: string }) { return <div className="flex items-center justify-between border-b border-border/70 pb-3 text-xs last:border-0 last:pb-0"><span className="flex items-center gap-2 text-muted-foreground"><Icon size={14} className="text-primary" />{label}</span><span className="font-mono font-medium">{value}</span></div>; }
function AiPreferenceCard() {
  const [length, setLength] = useState<'concise' | 'standard' | 'detailed'>(() => {
    try { return JSON.parse(localStorage.getItem('sitecheck-ai-preferences') ?? '{}').length ?? 'standard'; } catch { return 'standard'; }
  });
  const [includeTrade, setIncludeTrade] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sitecheck-ai-preferences') ?? '{}').includeTradeRecommendation ?? true; } catch { return true; }
  });
  const save = (nextLength: typeof length, nextIncludeTrade: boolean) => {
    setLength(nextLength);
    setIncludeTrade(nextIncludeTrade);
    localStorage.setItem('sitecheck-ai-preferences', JSON.stringify({ length: nextLength, includeTradeRecommendation: nextIncludeTrade }));
  };
  return <div className="rounded-lg border border-card-border bg-card p-5 shadow-sm"><div className="eyebrow">AI wording preference</div><h2 className="mt-1 text-base font-semibold">Finding output</h2><div className="mt-4 space-y-3"><select value={length} onChange={(event) => save(event.target.value as typeof length, includeTrade)} data-testid="select-report-ai-length" className="field-input"><option value="concise">Concise</option><option value="standard">Standard</option><option value="detailed">Detailed</option></select><label className="flex items-start gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={includeTrade} onChange={(event) => save(length, event.target.checked)} className="mt-0.5" /> Include relevant trade or further-inspection advice</label><p className="text-[11px] leading-relaxed text-muted-foreground">Saved on this device and applied to new findings.</p></div></div>;
}
function FindingCard({ finding, hasActiveSharedReport, editing, onEdit, onSaved }: { finding: import('@workspace/api-client-react').Finding; hasActiveSharedReport: boolean; editing: boolean; onEdit: () => void; onSaved: () => void }) {
  const mutation = useUpdateFinding();
  const duplicateMutation = useCreateFinding();
  const reclassifyMutation = useUpdateFindingMediaClassification();
  const deleteMediaMutation = useDeleteFindingMedia();
  const editWarning = useEditWarningDialog();
  const [recommendation, setRecommendation] = useState(finding.recommendation);
  const [editingCaptionId, setEditingCaptionId] = useState<number | null>(null);
  const [captionDraft, setCaptionDraft] = useState('');
  const media = finding.media ?? [];
  const mediaState = reportPhotoManagementState(media);
  const clientReportMediaCount = mediaState.reportCount;
  const duplicate = (trigger: HTMLElement | null) => {
    editWarning.openSharedReportWarning({
      hasActiveLink: hasActiveSharedReport,
      trigger,
      description: SHARED_REPORT_EDIT_WARNING,
      onConfirm: () => {
        const { id, inspectionId, createdAt, ...data } = finding;
        void id;
        void createdAt;
        duplicateMutation.mutate({ id: inspectionId, data: { ...data, title: `${finding.title} (copy)` } }, { onSuccess: onSaved });
      },
    });
  };
  const save = (trigger: HTMLElement | null) => {
    editWarning.openSharedReportWarning({
      hasActiveLink: hasActiveSharedReport,
      trigger,
      description: SHARED_REPORT_EDIT_WARNING,
      onConfirm: () => mutation.mutate({ id: finding.id, data: { recommendation } }, { onSuccess: onSaved }),
    });
  };
  const changeClassification = (mediaId: number, classification: 'client_report' | 'private_evidence', trigger: HTMLElement | null) => {
    if (classification === 'private_evidence' && isLastReportPhoto('client_report', clientReportMediaCount)) {
      const warning = hasActiveSharedReport
        ? 'This is the last client-report photo. Moving it to private evidence will revoke the active client link and make the report fail its photo-readiness check.'
        : 'This is the last client-report photo. Moving it to private evidence will make the report fail its photo-readiness check.';
      editWarning.open({
        title: hasActiveSharedReport ? 'Client link will stop working' : 'Photo readiness will change',
        description: warning,
        trigger,
        onConfirm: () => reclassifyMutation.mutate(
          { id: finding.id, mediaId, data: { classification } },
          { onSuccess: onSaved },
        ),
      });
      return;
    }
    reclassifyMutation.mutate(
      { id: finding.id, mediaId, data: { classification } },
      { onSuccess: onSaved },
    );
  };
  const startCaptionEdit = (mediaId: number, caption: string | null) => {
    setEditingCaptionId(mediaId);
    setCaptionDraft(caption ?? '');
  };
  const saveCaption = (
    mediaId: number,
    classification: 'client_report' | 'private_evidence',
    trigger: HTMLElement | null,
  ) => {
    editWarning.openSharedReportWarning({
      hasActiveLink: hasActiveSharedReport,
      trigger,
      description: SHARED_REPORT_EDIT_WARNING,
      onConfirm: () => reclassifyMutation.mutate(
        {
          id: finding.id,
          mediaId,
          data: {
            classification,
            caption: captionDraft.trim() || null,
          },
        },
        {
          onSuccess: () => {
            setEditingCaptionId(null);
            setCaptionDraft('');
            onSaved();
          },
        },
      ),
    });
  };
  const removeMedia = (mediaId: number, classification: 'client_report' | 'private_evidence', trigger: HTMLElement | null) => {
    const removingLastReportPhoto = isLastReportPhoto(classification, clientReportMediaCount);
    const warning = removingLastReportPhoto
      ? hasActiveSharedReport
        ? 'This is the last client-report photo. Removing it will revoke the active client link and make the report fail its photo-readiness check.'
        : 'This is the last client-report photo. Removing it will make the report fail its photo-readiness check.'
      : 'Remove this photo from the finding? This cannot be undone.';
    editWarning.open({
      title: removingLastReportPhoto && hasActiveSharedReport ? 'Client link will stop working' : 'Remove photo?',
      description: warning,
      trigger,
      onConfirm: () => deleteMediaMutation.mutate(
        { id: finding.id, mediaId },
        { onSuccess: onSaved },
      ),
    });
  };
  return <article data-testid={`card-finding-${finding.id}`} className="rounded-md border border-border/80 bg-background/50 p-4 transition hover:border-primary/35">
    {editWarning.dialog}
    <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><SeverityBadge severity={finding.severity} /><span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{titleCase(finding.category)}</span><span className="font-mono text-[10px] uppercase tracking-wider text-primary/80">{finding.area} · {finding.subCategory}</span></div><h3 className="mt-2 text-sm font-semibold">{finding.title}</h3><p className="mt-1 text-xs text-muted-foreground">{finding.location}</p></div><div className="flex items-center gap-3 self-end md:self-auto"><button onClick={(event) => duplicate(event.currentTarget)} disabled={duplicateMutation.isPending} data-testid={`button-duplicate-finding-${finding.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-primary"><CopyPlus size={13} /> {duplicateMutation.isPending ? 'Copying…' : 'Duplicate'}</button><button onClick={onEdit} data-testid={`button-edit-finding-${finding.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"><Edit3 size={13} /> {editing ? 'Close' : 'Edit'}</button></div></div><div className="mt-4 grid gap-3 border-t border-border/70 pt-3 text-xs md:grid-cols-2"><div><div className="eyebrow">Observed</div><p className="mt-1 leading-relaxed text-foreground/80">{finding.observed}</p></div><div><div className="eyebrow">Assessment</div><div className="mt-1 flex items-center gap-3"><AssessmentMark assessment={finding.assessment} /><Measurement value={finding.measuredValue} unit={finding.unit} /></div></div></div>{finding.pestRelevance !== 'not_applicable' && <div className="mt-3 rounded bg-[#EEE8D8] px-3 py-2 text-[11px] text-foreground/75"><span className="font-semibold">Pest relevance:</span> {titleCase(finding.pestRelevance)}</div>}{finding.clientExplanation && <div className="mt-3 rounded bg-primary/5 px-3 py-2 text-[11px] leading-relaxed text-foreground/75"><span className="font-semibold">What this means:</span> {finding.clientExplanation}</div>}<div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded bg-muted/55 px-3 py-2 text-[11px]"><span className="font-mono text-primary">{finding.standardRef}</span><span className="text-muted-foreground">{finding.standardTitle}</span><span className="ml-auto inline-flex items-center gap-1 text-muted-foreground"><Camera size={12} />{finding.reportPhotosCount} report · {finding.evidencePhotosCount} evidence</span></div>{media.length > 0 && <div className="mt-3 rounded-md border border-border/70 bg-card/60 p-3" data-testid={`media-list-${finding.id}`}><div className="flex items-center justify-between gap-2"><p className="text-[11px] font-semibold">Attached photos</p><span className="text-[10px] text-muted-foreground">{media.length} total</span></div>{clientReportMediaCount === 1 && <p className="mt-2 flex items-start gap-1.5 rounded border border-[#D7A55A]/40 bg-[#D7A55A]/10 p-2 text-[10px] leading-relaxed text-[#855B1B]" data-testid={`last-report-photo-warning-${finding.id}`}><AlertTriangle size={12} className="mt-0.5 shrink-0" />Moving or removing the last client-report photo will revoke an active client link and block report readiness.</p>}<div className="mt-2 space-y-2">{media.map((item) => <div key={item.id} className="flex flex-col gap-2 rounded border border-border/60 bg-background/60 p-2 sm:flex-row sm:items-center" data-testid={`media-item-${item.id}`}><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-medium">{item.fileName}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{item.contentType} · {formatFileSize(item.sizeBytes)} · {formatDate(item.createdAt)}</p>{editingCaptionId === item.id ? <div className="mt-2 flex flex-col gap-2 sm:flex-row"><input type="text" maxLength={500} value={captionDraft} onChange={(event) => setCaptionDraft(event.target.value)} aria-label={`Caption for ${item.fileName}`} data-testid={`input-media-caption-${item.id}`} className="field-input h-8 flex-1 py-1 text-[10px]" autoFocus /><div className="flex gap-2"><button type="button" onClick={() => { setEditingCaptionId(null); setCaptionDraft(''); }} className="btn-secondary h-8 px-2 text-[10px]">Cancel</button><button type="button" onClick={(event) => saveCaption(item.id, item.classification, event.currentTarget)} disabled={reclassifyMutation.isPending} data-testid={`button-save-media-caption-${item.id}`} className="btn-primary h-8 px-2 text-[10px]">{reclassifyMutation.isPending ? 'Saving…' : 'Save caption'}</button></div></div> : <div className="mt-1 flex items-center gap-2"><p className="min-w-0 truncate text-[10px] text-muted-foreground">{item.caption || 'No caption'}</p><button type="button" onClick={() => startCaptionEdit(item.id, item.caption)} data-testid={`button-edit-media-caption-${item.id}`} className="shrink-0 text-[10px] font-semibold text-primary hover:underline">Edit caption</button></div>}</div><div className="flex items-center gap-2"><select value={item.classification} onChange={(event) => changeClassification(item.id, event.target.value as 'client_report' | 'private_evidence', event.currentTarget)} disabled={reclassifyMutation.isPending || deleteMediaMutation.isPending} aria-label={`Classification for ${item.fileName}`} data-testid={`select-media-classification-${item.id}`} className="field-input h-8 py-1 text-[10px]"><option value="client_report">Client report</option><option value="private_evidence">Private evidence</option></select><button type="button" onClick={(event) => removeMedia(item.id, item.classification, event.currentTarget)} disabled={reclassifyMutation.isPending || deleteMediaMutation.isPending} aria-label={`Remove ${item.fileName}`} data-testid={`button-delete-media-${item.id}`} className="inline-flex h-8 items-center justify-center rounded border border-destructive/25 px-2 text-destructive hover:bg-destructive/10"><Trash2 size={13} /></button></div></div>)}</div></div>}{editing && <div className="mt-3 border-t border-border pt-3"><label className="block"><span className="mb-1.5 block text-xs font-semibold">Recommendation</span><textarea value={recommendation} onChange={(e) => setRecommendation(e.target.value)} data-testid={`textarea-edit-recommendation-${finding.id}`} className="field-input min-h-[72px] resize-y" /></label><button disabled={mutation.isPending} onClick={(event) => save(event.currentTarget)} data-testid={`button-save-finding-${finding.id}`} className="btn-primary mt-2 ml-auto"><Save size={14} /> {mutation.isPending ? 'Saving…' : 'Save finding'}</button></div>}
  </article>;
}