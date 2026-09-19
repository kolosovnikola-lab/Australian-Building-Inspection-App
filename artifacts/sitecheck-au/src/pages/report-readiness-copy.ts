export function missingFindingLabel(finding: { id: number; title: string }) {
  return `Finding ${finding.id}: ${finding.title}`;
}