export const SHARED_REPORT_EDIT_WARNING =
  'This report is currently shared with a client. Saving this change will stop the existing client link from working.';

export const SHARED_REPORT_EDIT_TITLE = 'Client link will stop working';

export function shouldWarnSharedReportEdit(hasActiveLink: boolean) {
  return hasActiveLink;
}