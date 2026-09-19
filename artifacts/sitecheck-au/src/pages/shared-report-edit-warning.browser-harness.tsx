import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SHARED_REPORT_EDIT_WARNING } from './shared-report-edit-warning';
import {
  PlainLanguageExplanationDialog,
  useEditWarningDialog,
} from './shared-report-edit-warning-dialog';

type BrowserTestWindow = Window & {
  runSharedWarningBrowserRegression?: () => Promise<void>;
};

function SharedWarningHarness() {
  const warning = useEditWarningDialog();
  const [inspectionMutations, setInspectionMutations] = useState(0);
  const [findingMutations, setFindingMutations] = useState(0);
  const [explanationOpen, setExplanationOpen] = useState(false);
  const [explanation, setExplanation] = useState('');
  const [explanationMutations, setExplanationMutations] = useState(0);
  const [explanationTrigger, setExplanationTrigger] = useState<HTMLElement | null>(null);

  const open = (
    trigger: HTMLElement | null,
    onConfirm: () => void,
  ) => warning.openSharedReportWarning({
    hasActiveLink: true,
    trigger,
    description: SHARED_REPORT_EDIT_WARNING,
    onConfirm,
  });

  return (
    <main>
      {warning.dialog}
      <button
        data-testid="inspection-warning-trigger"
        onClick={(event) => open(
          event.currentTarget,
          () => setInspectionMutations((count) => count + 1),
        )}
      >
        Update inspection status
      </button>
      <button
        data-testid="new-finding-warning-trigger"
        onClick={(event) => open(
          event.currentTarget,
          () => setFindingMutations((count) => count + 1),
        )}
      >
        Save new finding
      </button>
      <button
        data-testid="explanation-warning-trigger"
        onClick={(event) => {
          const trigger = event.currentTarget;
          setExplanationTrigger(trigger);
          warning.openSharedReportWarning({
            hasActiveLink: true,
            trigger,
            description: SHARED_REPORT_EDIT_WARNING,
            restoreFocus: false,
            onConfirm: () => setExplanationOpen(true),
          });
        }}
      >
        Add explanation
      </button>
      <output data-testid="inspection-mutations">{inspectionMutations}</output>
      <output data-testid="finding-mutations">{findingMutations}</output>
      <output data-testid="explanation-mutations">{explanationMutations}</output>
      <PlainLanguageExplanationDialog
        open={explanationOpen}
        findingTitle="Test finding"
        value={explanation}
        trigger={explanationTrigger}
        saving={false}
        error={null}
        onValueChange={setExplanation}
        onCancel={() => {
          setExplanationOpen(false);
          setExplanation('');
        }}
        onSave={() => {
          if (!explanation.trim()) return;
          setExplanationMutations((count) => count + 1);
          setExplanationOpen(false);
          setExplanation('');
        }}
      />
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Browser regression root is missing');
createRoot(root).render(<SharedWarningHarness />);

const nextFrame = () => new Promise<void>((resolve) => {
  setTimeout(resolve, 25);
});

function element<T extends HTMLElement>(testId: string): T {
  const match = document.querySelector<T>(`[data-testid="${testId}"]`);
  if (!match) throw new Error(`Missing element: ${testId}`);
  return match;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function assertDialogAccessibility() {
  const dialog = element<HTMLElement>('shared-report-edit-warning-dialog');
  assert(dialog.getAttribute('role') === 'alertdialog', 'Warning must use alertdialog role');
  const titleId = dialog.getAttribute('aria-labelledby');
  const descriptionId = dialog.getAttribute('aria-describedby');
  assert(Boolean(titleId), 'Warning must reference its title');
  assert(Boolean(descriptionId), 'Warning must reference its description');
  assert(
    document.getElementById(titleId!)?.textContent?.includes('Client link will stop working'),
    'Warning title must be exposed to assistive technology',
  );
  assert(
    document.getElementById(descriptionId!)?.textContent?.includes('existing client link from working'),
    'Warning description must be exposed to assistive technology',
  );
  assert(
    document.activeElement === element('shared-report-edit-warning-continue'),
    'Opening the warning must focus Continue',
  );
}

async function runSharedWarningBrowserRegression() {
  const inspectionTrigger = element<HTMLButtonElement>('inspection-warning-trigger');
  inspectionTrigger.focus();
  inspectionTrigger.click();
  await nextFrame();
  await assertDialogAccessibility();

  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape',
    code: 'Escape',
    bubbles: true,
    cancelable: true,
  }));
  await nextFrame();
  assert(!document.querySelector('[data-testid="shared-report-edit-warning-dialog"]'), 'Escape must close the warning');
  assert(element('inspection-mutations').textContent === '0', 'Escape must not run the inspection mutation');
  assert(document.activeElement === inspectionTrigger, 'Escape must restore inspection trigger focus');

  inspectionTrigger.click();
  await nextFrame();
  element<HTMLButtonElement>('shared-report-edit-warning-cancel').click();
  await nextFrame();
  assert(element('inspection-mutations').textContent === '0', 'Cancel must not run the inspection mutation');
  assert(document.activeElement === inspectionTrigger, 'Cancel must restore inspection trigger focus');

  inspectionTrigger.click();
  await nextFrame();
  element<HTMLButtonElement>('shared-report-edit-warning-continue').click();
  await nextFrame();
  assert(element('inspection-mutations').textContent === '1', 'Continue must run the deferred inspection mutation');
  assert(document.activeElement === inspectionTrigger, 'Continue must restore inspection trigger focus');

  const findingTrigger = element<HTMLButtonElement>('new-finding-warning-trigger');
  findingTrigger.focus();
  findingTrigger.click();
  await nextFrame();
  await assertDialogAccessibility();
  element<HTMLButtonElement>('shared-report-edit-warning-cancel').click();
  await nextFrame();
  assert(element('finding-mutations').textContent === '0', 'Cancel must not create a finding');
  assert(document.activeElement === findingTrigger, 'Cancel must restore new-finding trigger focus');

  const explanationTrigger = element<HTMLButtonElement>('explanation-warning-trigger');
  explanationTrigger.focus();
  explanationTrigger.click();
  await nextFrame();
  assert(
    !document.querySelector('[data-testid="plain-language-explanation-dialog"]'),
    'Explanation editor must not bypass the shared-link warning',
  );
  element<HTMLButtonElement>('shared-report-edit-warning-continue').click();
  await nextFrame();
  const explanationInput = element<HTMLTextAreaElement>('plain-language-explanation-input');
  const saveExplanation = element<HTMLButtonElement>('plain-language-explanation-save');
  assert(document.activeElement === explanationInput, 'Explanation editor must focus its labeled textarea');
  assert(
    document.querySelector(`label[for="${explanationInput.id}"]`)?.textContent?.includes('What this finding means'),
    'Explanation textarea must have a visible label',
  );
  assert(saveExplanation.disabled, 'Whitespace-only explanation saves must be disabled');
  element<HTMLButtonElement>('plain-language-explanation-cancel').click();
  await nextFrame();
  assert(element('explanation-mutations').textContent === '0', 'Cancel must leave the finding unchanged');
  assert(document.activeElement === explanationTrigger, 'Explanation Cancel must restore initiating focus');

  explanationTrigger.click();
  await nextFrame();
  element<HTMLButtonElement>('shared-report-edit-warning-continue').click();
  await nextFrame();
  const reopenedInput = element<HTMLTextAreaElement>('plain-language-explanation-input');
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )?.set;
  valueSetter?.call(reopenedInput, 'A clear client explanation.');
  reopenedInput.dispatchEvent(new Event('input', { bubbles: true }));
  await nextFrame();
  element<HTMLButtonElement>('plain-language-explanation-save').click();
  await nextFrame();
  assert(element('explanation-mutations').textContent === '1', 'Save must run one explanation mutation');
  assert(document.activeElement === explanationTrigger, 'Explanation Save must restore initiating focus');
}

(window as BrowserTestWindow).runSharedWarningBrowserRegression = runSharedWarningBrowserRegression;

void (async () => {
  const result = document.getElementById('result');
  try {
    await nextFrame();
    await runSharedWarningBrowserRegression();
    document.body.dataset.testResult = 'pass';
    if (result) result.textContent = 'PASS';
  } catch (error) {
    document.body.dataset.testResult = 'fail';
    if (result) result.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
  }
})();