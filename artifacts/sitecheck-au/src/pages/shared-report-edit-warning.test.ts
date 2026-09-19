import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldWarnSharedReportEdit, SHARED_REPORT_EDIT_TITLE, SHARED_REPORT_EDIT_WARNING } from './shared-report-edit-warning.ts';

test('shared-report warnings have explicit dialog copy', () => {
  assert.equal(SHARED_REPORT_EDIT_TITLE, 'Client link will stop working');
  assert.match(SHARED_REPORT_EDIT_WARNING, /existing client link/);
});

test('active shared links require a warning dialog', () => {
  assert.equal(shouldWarnSharedReportEdit(true), true);
  assert.equal(shouldWarnSharedReportEdit(false), false);
});