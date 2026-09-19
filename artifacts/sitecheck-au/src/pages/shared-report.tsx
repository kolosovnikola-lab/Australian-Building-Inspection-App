import { useEffect, useState } from 'react';
import { Camera, Download, MapPin, ShieldCheck } from 'lucide-react';
import { useParams } from 'wouter';
import { getGetSharedReportQueryKey, useGetSharedReport, useMarkReportViewed } from '@workspace/api-client-react';
import type { ClientReport } from '@workspace/api-client-react';
import { ErrorState, LoadingRows, SeverityBadge, formatDate, titleCase } from '@/components/ui-pieces';
import { buildPlainLanguageSummary, selectPlainLanguageSummary } from './plain-language-summary';

export function SharedReportPage() {
  const { token = '' } = useParams<{ token: string }>();
  const query = useGetSharedReport(token, { query: { queryKey: getGetSharedReportQueryKey(token), enabled: token.length >= 16 } });
  const markViewed = useMarkReportViewed();
  const report = query.data;
  const isInspectorPreview = new URLSearchParams(window.location.search).get('preview') === '1';
  useEffect(() => {
    if (!report) return;
    document.title = `${report.reportNumber} · ${report.propertyAddress}`;
    if (!isInspectorPreview) markViewed.mutate({ token });
    return () => { document.title = 'SiteCheck AU'; };
  }, [report, token, isInspectorPreview]);
  if (query.isLoading) return <div className="mx-auto max-w-4xl p-6"><LoadingRows count={6} /></div>;
  if (query.isError || !report) return <div className="mx-auto max-w-xl p-6"><div role="alert" data-testid="shared-report-link-warning" className="rounded-lg border border-[#D7A55A]/50 bg-[#FFF7E7] p-5 text-[#5C421B]"><p className="text-xs font-semibold uppercase tracking-[.14em]">Report link unavailable</p><h1 className="mt-2 text-xl font-semibold">This report link may have been replaced or invalidated.</h1><p className="mt-2 text-sm leading-relaxed">Ask the inspector for the latest private link. If this is a temporary connection issue, you can try again.</p><button type="button" onClick={() => query.refetch()} data-testid="button-retry-shared-report" className="btn-secondary mt-4 border-[#B88936]/40">Try again</button></div></div>;
  return <SharedReportDocument report={report} />;
}

export function SharedReportDocument({ report }: { report: ClientReport }) {
  const [showEnglishSummary, setShowEnglishSummary] = useState(false);
  const englishPlainLanguageSummary = buildPlainLanguageSummary(report.findings);
  const translatedSummary = report.summaryLanguage !== 'en' && !showEnglishSummary;
   const plainLanguageSummary = selectPlainLanguageSummary(report.summaryLanguage, showEnglishSummary, report.plainLanguageSummary, englishPlainLanguageSummary);
  const summaryLanguageLabel = report.summaryLanguage === 'zh-Hans'
    ? 'Simplified Chinese'
    : report.summaryLanguage === 'vi'
      ? 'Vietnamese'
      : report.summaryLanguage === 'ar'
        ? 'Arabic'
        : 'English';
  return <main className="report-document min-h-screen bg-[#F3F0E8] text-[#1D2B29]">
    <header className="report-toolbar sticky top-0 z-20 border-b border-black/10 bg-white/95 px-4 py-3 backdrop-blur"><div className="mx-auto flex max-w-4xl items-center justify-between gap-3"><div><p className="text-xs font-semibold">SiteCheck AU</p><p className="font-mono text-[10px] text-muted-foreground">{report.reportNumber}</p></div><button onClick={() => window.print()} data-testid="button-create-pdf" className="btn-primary"><Download size={15} /> Create PDF</button></div></header>
    <article className="report-sheet mx-auto max-w-4xl bg-white px-5 py-8 shadow-sm sm:px-10 sm:py-12">
      <section className="border-b-2 border-[#254541] pb-8"><div className="eyebrow">SiteCheck AU · Client report</div><h1 className="mt-4 text-3xl font-semibold tracking-[-.04em] sm:text-5xl">{report.title}</h1><p className="mt-4 flex items-start gap-2 text-sm text-muted-foreground"><MapPin size={16} className="mt-0.5" />{report.propertyAddress}</p><div className="mt-7 grid gap-4 text-sm sm:grid-cols-3"><Meta label="Prepared for" value={report.clientName} /><Meta label="Inspected" value={formatDate(report.inspectionDate)} /><Meta label="Inspector" value={report.inspectorName} /></div></section>
      <section className="grid gap-3 border-b border-border py-7 sm:grid-cols-3"><Summary value={String(report.findings.length)} label="Findings" /><Summary value={String(report.findings.filter((f) => ['critical', 'high'].includes(f.severity)).length)} label="High priority" /><Summary value={String(report.findings.reduce((sum, f) => sum + f.reportPhotosCount, 0))} label="Report photos" /></section>
      <section className="border-b border-border py-8" data-testid="plain-language-summary">
        <div className="rounded-xl border border-[#B8CEC7] bg-[#EEF5F1] p-5 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3"><div className="eyebrow text-[#365552]">{translatedSummary ? `Translated plain-language summary · ${summaryLanguageLabel}` : 'In plain language · English'}</div>{report.summaryLanguage !== 'en' && <button type="button" onClick={() => setShowEnglishSummary((current) => !current)} aria-label={showEnglishSummary ? `View the ${summaryLanguageLabel} summary` : 'View the English summary'} className="btn-secondary px-3 py-1.5 text-[11px]" data-testid="button-toggle-summary-language">{showEnglishSummary ? `View ${summaryLanguageLabel}` : 'View English'}</button>}</div>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-.03em]">What you need to know</h2>
           <p className="mt-2 max-w-2xl text-sm leading-relaxed text-foreground/70">{translatedSummary ? `This summary is translated from the inspector-approved English explanations into ${summaryLanguageLabel}. Read the professional findings below for the full observations, recommendations, and Standards references.` : 'This summary explains the inspector’s findings in simpler terms. Read the professional findings below for the full observations, recommendations, and Standards references.'}</p>
           <p className="mt-3 rounded-md border border-[#D7A55A]/40 bg-[#D7A55A]/10 px-3 py-2 text-xs leading-relaxed text-[#855B1B]" data-testid="translation-notice">{report.translationNotice}</p>
          {plainLanguageSummary.length ? <ol className="mt-6 space-y-4">{plainLanguageSummary.map((finding) => <li key={finding.id} className="break-inside-avoid rounded-lg bg-white/80 p-4"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[10px] text-muted-foreground">Finding {finding.reportPosition}</span><SeverityBadge severity={finding.severity as 'critical' | 'high' | 'medium' | 'low'} /></div><p className="mt-2 text-sm font-semibold">{finding.title}</p><p className="mt-1 text-sm leading-relaxed text-foreground/80">{finding.summary}</p></li>)}</ol> : <p className="mt-5 text-sm text-muted-foreground">No findings were recorded for this inspection.</p>}
        </div>
      </section>
       <section className="py-8"><div className="eyebrow">Inspection findings</div><div className="mt-5 space-y-6">{report.findings.map((finding, index) => <article key={finding.id} className="report-finding break-inside-avoid rounded-lg border border-border p-5"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[10px] text-muted-foreground">{String(index + 1).padStart(2, '0')}</span><SeverityBadge severity={finding.severity} /><span className="text-[10px] font-semibold uppercase tracking-wider text-primary">{finding.area} · {finding.subCategory}</span></div><h2 className="mt-3 text-xl font-semibold">{finding.title}</h2><p className="mt-1 text-xs text-muted-foreground">{finding.location}</p><div className="mt-5 grid gap-5 sm:grid-cols-2"><ReportBlock label="What we observed" text={finding.observed} /><ReportBlock label="What this means" text={finding.clientExplanation || finding.requirement} /><ReportBlock label="Recommendation" text={finding.recommendation} /><ReportBlock label="Reference" text={`${finding.standardRef} · ${finding.standardTitle}`} /></div>{finding.media.length > 0 && <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">{finding.media.map((media) => <a key={media.id} href={media.url} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-md border border-border bg-[#F3F0E8]"><img src={media.thumbnailUrl ?? media.url} alt={media.caption || `${finding.title} inspection photo`} loading="lazy" className="aspect-[4/3] w-full object-cover transition-transform group-hover:scale-[1.02]" /><span className="block px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">{media.caption || 'Inspection photo'}</span></a>)}</div>}{finding.reportPhotosCount > 0 && <div className="mt-5 flex items-center gap-2 rounded-md bg-[#F3F0E8] px-3 py-2 text-xs"><Camera size={14} /><strong>{finding.reportPhotosCount}</strong> client-report photo{finding.reportPhotosCount === 1 ? '' : 's'} included</div>}</article>)}</div></section>
      <footer className="border-t border-border pt-6 text-[11px] leading-relaxed text-muted-foreground"><p className="flex items-center gap-2 font-semibold text-foreground"><ShieldCheck size={14} /> Report integrity</p><p className="mt-2">This report contains only material selected for client delivery. Private inspector evidence is retained separately and is not included in this report. Standards references are traceability aids and should be checked against current licensed source material where required.</p><p className="mt-3">Issued {formatDate(report.issuedAt)} · {titleCase(report.reportType)} · {report.reportNumber}</p></footer>
    </article>
  </main>;
}

function Meta({ label, value }: { label: string; value: string }) { return <div><div className="eyebrow">{label}</div><p className="mt-1 font-semibold">{value}</p></div>; }
function Summary({ value, label }: { value: string; label: string }) { return <div className="rounded-md bg-[#F3F0E8] p-4"><p className="font-mono text-2xl">{value}</p><p className="mt-1 text-xs text-muted-foreground">{label}</p></div>; }
function ReportBlock({ label, text }: { label: string; text: string }) { return <div><div className="eyebrow">{label}</div><p className="mt-2 text-sm leading-relaxed text-foreground/80">{text}</p></div>; }