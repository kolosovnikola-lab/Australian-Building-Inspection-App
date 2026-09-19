export type PlainLanguageFinding = {
  id: number;
  title: string;
  location: string;
  severity: string;
  clientExplanation: string | null;
};

const priority: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function buildPlainLanguageSummary(findings: PlainLanguageFinding[]) {
  return findings
    .map((finding, index) => ({
      ...finding,
      reportPosition: index + 1,
      summary: finding.clientExplanation?.trim()
        || `The inspector recorded “${finding.title}” at ${finding.location}. Please read finding ${index + 1} below for the professional assessment and recommended next step.`,
    }))
    .sort((a, b) => (priority[a.severity] ?? 4) - (priority[b.severity] ?? 4));
}

export function selectPlainLanguageSummary<T>(
  summaryLanguage: string,
  showEnglishSummary: boolean,
  translatedSummary: T[],
  englishSummary: T[],
) {
  return summaryLanguage !== 'en' && !showEnglishSummary
    ? translatedSummary
    : englishSummary;
}