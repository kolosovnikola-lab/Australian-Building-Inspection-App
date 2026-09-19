import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isLastReportPhoto,
  reportPhotoManagementState,
  withMediaClassification,
  withoutMedia,
} from './report-photo-management.ts';

test('media controls show the last-photo warning after reclassification and refresh counts', () => {
  const initial = [
    { id: 1, classification: 'client_report' as const },
    { id: 2, classification: 'client_report' as const },
    { id: 3, classification: 'private_evidence' as const },
  ];

  assert.deepEqual(reportPhotoManagementState(initial), {
    totalCount: 3,
    reportCount: 2,
    evidenceCount: 1,
    showLastReportPhotoWarning: false,
  });

  const afterReclassification = withMediaClassification(initial, 1, 'private_evidence');
  assert.deepEqual(reportPhotoManagementState(afterReclassification), {
    totalCount: 3,
    reportCount: 1,
    evidenceCount: 2,
    showLastReportPhotoWarning: true,
  });
  assert.equal(isLastReportPhoto(afterReclassification[1].classification, 1), true);
});

test('deleting the final report photo clears its warning and exposes zero report photos', () => {
  const oneReportPhoto = [
    { id: 1, classification: 'private_evidence' as const },
    { id: 2, classification: 'client_report' as const },
    { id: 3, classification: 'private_evidence' as const },
  ];

  const afterDeletion = withoutMedia(oneReportPhoto, 2);
  assert.deepEqual(reportPhotoManagementState(afterDeletion), {
    totalCount: 2,
    reportCount: 0,
    evidenceCount: 2,
    showLastReportPhotoWarning: false,
  });
  assert.equal(isLastReportPhoto('private_evidence', 0), false);
});