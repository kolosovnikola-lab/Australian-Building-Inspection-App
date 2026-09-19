export type ReportLinkState = {
  shareUrl: string;
  currentShareToken: string;
};

export function reportLinkStateFromUrl(
  shareUrl: string | null | undefined,
): ReportLinkState {
  if (!shareUrl) {
    return { shareUrl: "", currentShareToken: "" };
  }
  const currentShareToken =
    shareUrl.split("/").filter(Boolean).at(-1) ?? "";
  return { shareUrl, currentShareToken };
}