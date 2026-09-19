import { createRoot } from 'react-dom/client';
import { SharedReportDocument } from '@/pages/shared-report';
import { readabilityBoundaryReport } from '@/pages/shared-report-readability.fixture';
import '@/index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Shared report PDF regression root is missing');

const nativePrint = window.print;
window.print = () => {
  document.body.dataset.pdfFlowRequested = 'true';
};

createRoot(root).render(<SharedReportDocument report={readabilityBoundaryReport} />);

setTimeout(() => {
  const button = document.querySelector<HTMLButtonElement>('[data-testid="button-create-pdf"]');
  if (!button) {
    document.body.dataset.testResult = 'fail';
    return;
  }
  button.click();
  document.body.dataset.testResult =
    document.body.dataset.pdfFlowRequested === 'true' ? 'pass' : 'fail';
  window.print = nativePrint;
}, 25);