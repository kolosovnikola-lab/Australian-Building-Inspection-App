import type { ClientReport } from '@workspace/api-client-react';

export const approvedReadabilityExplanation =
  'Efflorescence is visible on the substrate after moisture ingress.';

export const forbiddenClientOutputText = [
  'long_sentence',
  'technical_term',
  'Consider splitting this into shorter sentences.',
  'Consider explaining “efflorescence”.',
  'readiness object inspector only',
  'tracked term metadata inspector only',
  'advisories',
  'warnings',
];

export const readabilityBoundaryReport = {
  inspectionId: 1,
  reportNumber: 'SC-READABILITY',
  title: 'Pre-purchase building inspection',
  propertyAddress: '1 Test Street',
  clientName: 'Test Client',
  inspectionDate: '2026-09-18',
  inspectorName: 'Test Inspector',
  reportType: 'pre_purchase',
  issuedAt: '2026-09-18',
  summaryLanguage: 'en',
  translationNotice: 'The English professional report controls.',
  plainLanguageSummary: [{
    id: 10,
    title: 'Moisture staining',
    location: 'Laundry wall',
    severity: 'medium',
    reportPosition: 1,
    summary: approvedReadabilityExplanation,
  }],
  findings: [{
    id: 10,
    area: 'Interior',
    subCategory: 'Walls',
    category: 'Moisture',
    title: 'Moisture staining',
    location: 'Laundry wall',
    severity: 'medium',
    observed: 'White deposits and staining were visible.',
    standardRef: 'Reference 1',
    standardTitle: 'Inspection reference',
    requirement: 'The wall should remain dry.',
    tolerance: 'No visible moisture staining.',
    measuredValue: null,
    unit: null,
    assessment: 'monitor',
    recommendation: 'Ask a qualified contractor to investigate.',
    clientExplanation: approvedReadabilityExplanation,
    reportPhotosCount: 0,
    media: [],
  }],
  advisories: [{
    id: 10,
    warnings: [
      { kind: 'long_sentence', message: 'Consider splitting this into shorter sentences.' },
      { kind: 'technical_term', term: 'efflorescence', message: 'Consider explaining “efflorescence”.' },
    ],
  }],
  readiness: {
    internalLabel: 'readiness object inspector only',
  },
  trackedTermMetadata: 'tracked term metadata inspector only',
} satisfies ClientReport & {
  advisories: Array<{
    id: number;
    warnings: Array<{ kind: string; term?: string; message: string }>;
  }>;
  readiness: { internalLabel: string };
  trackedTermMetadata: string;
};