export type ReportPhotoMedia = {
  id: number;
  classification: 'client_report' | 'private_evidence';
};

export function reportPhotoManagementState(media: readonly ReportPhotoMedia[]) {
  const reportCount = media.filter((item) => item.classification === 'client_report').length;
  const evidenceCount = media.length - reportCount;

  return {
    totalCount: media.length,
    reportCount,
    evidenceCount,
    showLastReportPhotoWarning: reportCount === 1,
  };
}

export function isLastReportPhoto(
  classification: ReportPhotoMedia['classification'],
  reportCount: number,
) {
  return classification === 'client_report' && reportCount <= 1;
}

export function withMediaClassification(
  media: readonly ReportPhotoMedia[],
  mediaId: number,
  classification: ReportPhotoMedia['classification'],
) {
  return media.map((item) => item.id === mediaId ? { ...item, classification } : item);
}

export function withoutMedia(
  media: readonly ReportPhotoMedia[],
  mediaId: number,
) {
  return media.filter((item) => item.id !== mediaId);
}