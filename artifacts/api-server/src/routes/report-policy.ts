import type { Finding, FindingMedia, Inspection } from "@workspace/db";
import type { ReportSummaryLanguage, TranslatedExplanation } from "../lib/report-translation";

type ReadinessFinding = Pick<
  Finding,
  "id" | "title" | "recommendation" | "clientExplanation"
>;

export type ClientLanguageGlossaryTerm = {
  term: string;
  suggestedMeaning: string;
};

export const DEFAULT_CLIENT_LANGUAGE_GLOSSARY: ClientLanguageGlossaryTerm[] = [
  { term: "efflorescence", suggestedMeaning: "salt deposits" },
  { term: "capillary", suggestedMeaning: "water moving through tiny gaps" },
  { term: "delamination", suggestedMeaning: "a surface layer separating" },
  { term: "differential movement", suggestedMeaning: "different parts moving by different amounts" },
  { term: "hydrostatic", suggestedMeaning: "water pressure" },
  { term: "moisture ingress", suggestedMeaning: "water getting in" },
  { term: "non-compliant", suggestedMeaning: "not meeting the stated requirement" },
  { term: "spalling", suggestedMeaning: "surface material breaking away" },
  { term: "substrate", suggestedMeaning: "the underlying surface" },
  { term: "subfloor", suggestedMeaning: "the floor structure underneath" },
];

export type ClientExplanationWarning = {
  kind: "long_sentence" | "technical_term";
  message: string;
  term?: string;
};

export type ClientExplanationAdvisory = {
  id: number;
  title: string;
  warnings: ClientExplanationWarning[];
};

const MAX_PLAIN_LANGUAGE_SENTENCE_WORDS = 28;

function sentenceWordCount(sentence: string) {
  return sentence.trim().split(/\s+/).filter(Boolean).length;
}

export function reviewClientExplanation(
  explanation: string | null | undefined,
  glossary: ClientLanguageGlossaryTerm[] = DEFAULT_CLIENT_LANGUAGE_GLOSSARY,
): ClientExplanationWarning[] {
  const text = explanation?.trim() ?? "";
  if (!text) return [];

  const warnings: ClientExplanationWarning[] = [];
  const sentences = text.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [text];
  for (const sentence of sentences) {
    const wordCount = sentenceWordCount(sentence);
    if (wordCount > MAX_PLAIN_LANGUAGE_SENTENCE_WORDS) {
      warnings.push({
        kind: "long_sentence",
        message: `This sentence has ${wordCount} words. Consider splitting it into shorter sentences.`,
      });
    }
  }

  for (const { term, suggestedMeaning: plainMeaning } of glossary) {
    if (new RegExp(`\\b${term.replaceAll(" ", "\\s+")}\\b`, "i").test(text)) {
      warnings.push({
        kind: "technical_term",
        term,
        message: `Consider explaining “${term}” in simpler words, such as “${plainMeaning}”.`,
      });
    }
  }
  return warnings;
}

type ReportFinding = Pick<
  Finding,
  | "id"
  | "area"
  | "subCategory"
  | "category"
  | "title"
  | "location"
  | "severity"
  | "observed"
  | "standardRef"
  | "standardTitle"
  | "requirement"
  | "tolerance"
  | "measuredValue"
  | "unit"
  | "assessment"
  | "recommendation"
  | "clientExplanation"
  | "reportPhotosCount"
> & { media: ReportMedia[] };

export type ReportMedia = {
  id: number;
  contentType: string;
  caption: string | null;
  url: string;
  thumbnailUrl: string | null;
};

export const revokeReportDelivery = {
  reportStatus: "draft",
  deliveryStatus: "not_shared",
  reportRecipientType: null,
  reportRecipientEmail: null,
  reportSummaryLanguage: null,
  reportSummaryTranslations: null,
  reportShareToken: null,
  reportDeliveryAttemptId: null,
  reportDeliveryIdempotencyKey: null,
  reportDeliveryProviderId: null,
  reportDeliveryError: null,
  reportReadyAt: null,
  reportDeliveryAttemptedAt: null,
  reportSharedAt: null,
  reportDeliveredAt: null,
  reportViewedAt: null,
} as const;

export const invalidateReportDelivery = {
  reportStatus: "draft",
  deliveryStatus: "not_shared",
  reportSummaryLanguage: null,
  reportSummaryTranslations: null,
  reportShareToken: null,
  reportDeliveryAttemptId: null,
  reportDeliveryIdempotencyKey: null,
  reportDeliveryProviderId: null,
  reportDeliveryError: null,
  reportReadyAt: null,
  reportDeliveryAttemptedAt: null,
  reportSharedAt: null,
  reportDeliveredAt: null,
  reportViewedAt: null,
} as const;

export function getReportReadiness(
  inspection: Pick<Inspection, "status">,
  findings: ReadinessFinding[],
  media: Pick<FindingMedia, "findingId" | "classification">[] = [],
  glossary: ClientLanguageGlossaryTerm[] = DEFAULT_CLIENT_LANGUAGE_GLOSSARY,
) {
  const missingRecommendations = findings.filter(
    (finding) => finding.recommendation.trim().length === 0,
  );
  const missingClientExplanations = findings.filter(
    (finding) => !finding.clientExplanation?.trim(),
  );
  const clientExplanationAdvisories: ClientExplanationAdvisory[] = findings
    .map((finding) => ({
      id: finding.id,
      title: finding.title,
       warnings: reviewClientExplanation(finding.clientExplanation, glossary),
    }))
    .filter((advisory) => advisory.warnings.length > 0);
  const reportPhotoFindingIds = new Set(
    media
      .filter((item) => item.classification === "client_report")
      .map((item) => item.findingId),
  );
  const missingReportPhotos = findings.filter(
    (finding) => !reportPhotoFindingIds.has(finding.id),
  );
  const toMissingFindings = (items: ReadinessFinding[]) =>
    items.map(({ id, title }) => ({ id, title }));

  const checks = [
    {
      key: "inspection_complete" as const,
      label: "Inspection marked complete",
      complete: inspection.status === "complete",
      detail:
        inspection.status === "complete"
          ? "Field inspection is complete."
          : "Mark the inspection complete after finishing field work.",
      missingFindings: [],
    },
    {
      key: "findings_present" as const,
      label: "Findings recorded",
      complete: findings.length > 0,
      detail: findings.length
        ? `${findings.length} finding${findings.length === 1 ? "" : "s"} included.`
        : "Add at least one finding to the report.",
      missingFindings: [],
    },
    {
      key: "recommendations_complete" as const,
      label: "Recommendations complete",
      complete:
        findings.length > 0 && missingRecommendations.length === 0,
      detail: missingRecommendations.length === 0
        ? "Every finding has an inspector recommendation."
        : "Add a recommendation to every finding.",
      missingFindings: toMissingFindings(missingRecommendations),
    },
    {
      key: "client_explanations_complete" as const,
      label: "Client explanations complete",
      complete:
        findings.length > 0 && missingClientExplanations.length === 0,
      detail: missingClientExplanations.length === 0
        ? clientExplanationAdvisories.length === 0
          ? "Every finding is explained in client-friendly language."
          : `Every finding has an explanation. ${clientExplanationAdvisories.length} may need simpler wording.`
        : `${missingClientExplanations.length} finding${missingClientExplanations.length === 1 ? " needs" : "s need"} an inspector-approved plain-language explanation.`,
      missingFindings: toMissingFindings(missingClientExplanations),
    },
    {
      key: "report_photos_present" as const,
      label: "Report photos selected",
      complete:
        findings.length > 0 && missingReportPhotos.length === 0,
      detail: missingReportPhotos.length === 0
        ? "Every finding has client-report imagery."
        : "Select at least one report photo for every finding. Private evidence does not count.",
      missingFindings: toMissingFindings(missingReportPhotos),
    },
  ];

  return {
    ready: checks.every((check) => check.complete),
    completedCount: checks.filter((check) => check.complete).length,
    totalCount: checks.length,
    checks,
    advisories: clientExplanationAdvisories,
  };
}

export function toClientReportMedia(
  media: FindingMedia[],
  reportToken: string,
): ReportMedia[] {
  return media
    .filter((item) => item.classification === "client_report")
    .map(({ id, contentType, caption, thumbnailObjectPath }) => ({
      id,
      contentType,
      caption,
      url: `/api/reports/${reportToken}/media/${id}/original`,
      thumbnailUrl: thumbnailObjectPath
        ? `/api/reports/${reportToken}/media/${id}/thumbnail`
        : null,
    }));
}

export function getReportMediaObjectPath(
  media: FindingMedia,
  variant: "original" | "thumbnail",
): string | null {
  if (media.classification !== "client_report") return null;
  return variant === "thumbnail"
    ? media.thumbnailObjectPath
    : media.objectPath;
}

export function toClientReportFindings(
  findings: Finding[],
  media: FindingMedia[] = [],
  reportToken = "",
): ReportFinding[] {
  return findings.map(
    ({
      id,
      area,
      subCategory,
      category,
      title,
      location,
      severity,
      observed,
      standardRef,
      standardTitle,
      requirement,
      tolerance,
      measuredValue,
      unit,
      assessment,
      recommendation,
      clientExplanation,
    }) => ({
      id,
      area,
      subCategory,
      category,
      title,
      location,
      severity,
      observed,
      standardRef,
      standardTitle,
      requirement,
      tolerance,
      measuredValue,
      unit,
      assessment,
      recommendation,
      clientExplanation,
      reportPhotosCount: media.filter(
        (item) => item.findingId === id && item.classification === "client_report",
      ).length,
      media: toClientReportMedia(
        media.filter((item) => item.findingId === id),
        reportToken,
      ),
    }),
  );
}

export type ClientPlainLanguageSummaryItem = {
  id: number;
  title: string;
  location: string;
  severity: string;
  reportPosition: number;
  summary: string;
};

const summaryPriority: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function toClientPlainLanguageSummary(
  findings: Finding[],
  translations: TranslatedExplanation[],
): ClientPlainLanguageSummaryItem[] {
  const translatedByFindingId = new Map(
    translations.map((translation) => [translation.id, translation.text]),
  );
  return findings
    .map((finding, index) => {
      const approvedText = finding.clientExplanation?.trim();
      const translatedText = translatedByFindingId.get(finding.id);
      if (!approvedText || !translatedText) {
        throw new Error(`Missing approved client explanation translation for finding ${finding.id}`);
      }
      return {
        id: finding.id,
        title: finding.title,
        location: finding.location,
        severity: finding.severity,
        reportPosition: index + 1,
        summary: translatedText,
      };
    })
    .sort((a, b) => (summaryPriority[a.severity] ?? 4) - (summaryPriority[b.severity] ?? 4));
}

export function buildSharedDeliveryUpdate({
  token,
  recipientType,
  recipientEmail,
  summaryLanguage,
  summaryTranslations,
  sharedAt,
}: {
  token: string;
  recipientType: "client" | "agent";
  recipientEmail: string;
  summaryLanguage: ReportSummaryLanguage;
  summaryTranslations: TranslatedExplanation[];
  sharedAt: Date;
}) {
  return {
    reportShareToken: token,
    reportRecipientType: recipientType,
    reportRecipientEmail: recipientEmail,
    reportSummaryLanguage: summaryLanguage,
    reportSummaryTranslations: JSON.stringify(summaryTranslations),
    deliveryStatus: "shared",
    reportSharedAt: sharedAt,
    reportViewedAt: null,
    updatedAt: sharedAt,
  } as const;
}
