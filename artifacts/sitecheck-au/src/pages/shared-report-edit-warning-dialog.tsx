import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SHARED_REPORT_EDIT_TITLE, shouldWarnSharedReportEdit } from './shared-report-edit-warning';

type WarningRequest = {
  title: string;
  description: string;
  trigger: HTMLElement | null;
  onConfirm: () => void;
  restoreFocus?: boolean;
};

type SharedReportWarningRequest = {
  hasActiveLink: boolean;
  trigger: HTMLElement | null;
  onConfirm: () => void;
  description: string;
  restoreFocus?: boolean;
};

export function useEditWarningDialog() {
  const [request, setRequest] = useState<WarningRequest | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef(true);

  const open = useCallback((nextRequest: WarningRequest) => {
    triggerRef.current = nextRequest.trigger;
    restoreFocusRef.current = nextRequest.restoreFocus !== false;
    setRequest(nextRequest);
  }, []);

  const openSharedReportWarning = useCallback((nextRequest: SharedReportWarningRequest) => {
    if (!shouldWarnSharedReportEdit(nextRequest.hasActiveLink)) {
      nextRequest.onConfirm();
      return;
    }
    open({
      title: SHARED_REPORT_EDIT_TITLE,
      description: nextRequest.description,
      trigger: nextRequest.trigger,
      onConfirm: nextRequest.onConfirm,
      restoreFocus: nextRequest.restoreFocus,
    });
  }, [open]);

  const close = useCallback(() => setRequest(null), []);

  const dialog = (
    <AlertDialog open={Boolean(request)} onOpenChange={(openState) => !openState && close()}>
      <AlertDialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          confirmButtonRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (triggerRef.current && restoreFocusRef.current) {
            event.preventDefault();
            triggerRef.current.focus();
          }
          triggerRef.current = null;
          restoreFocusRef.current = true;
        }}
        data-testid="shared-report-edit-warning-dialog"
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{request?.title}</AlertDialogTitle>
          <AlertDialogDescription>{request?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={close} data-testid="shared-report-edit-warning-cancel">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            ref={confirmButtonRef}
            onClick={() => {
              const currentRequest = request;
              close();
              currentRequest?.onConfirm();
            }}
            data-testid="shared-report-edit-warning-continue"
          >
            Continue
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { open, openSharedReportWarning, dialog };
}

export function PlainLanguageExplanationDialog({
  open,
  findingTitle,
  value,
  trigger,
  saving,
  error,
  onValueChange,
  onCancel,
  onSave,
}: {
  open: boolean;
  findingTitle: string;
  value: string;
  trigger: HTMLElement | null;
  saving: boolean;
  error: string | null;
  onValueChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const triggerRef = useRef<HTMLElement | null>(trigger);
  useEffect(() => {
    if (open) triggerRef.current = trigger;
  }, [open, trigger]);
  const inputId = 'plain-language-explanation';

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogContent
        data-testid="plain-language-explanation-dialog"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          textareaRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (triggerRef.current) {
            event.preventDefault();
            triggerRef.current.focus();
            triggerRef.current = null;
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Add a plain-language explanation</DialogTitle>
          <DialogDescription>
            Write the inspector-approved client explanation for “{findingTitle}”.
          </DialogDescription>
        </DialogHeader>
        <label htmlFor={inputId} className="text-sm font-semibold">
          What this finding means for the client
        </label>
        <textarea
          ref={textareaRef}
          id={inputId}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          className="field-input min-h-[120px] resize-y"
          data-testid="plain-language-explanation-input"
        />
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <button
            type="button"
            className="btn-secondary"
            onClick={onCancel}
            disabled={saving}
            data-testid="plain-language-explanation-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onSave}
            disabled={saving || !value.trim()}
            data-testid="plain-language-explanation-save"
          >
            {saving ? 'Saving…' : 'Save explanation'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}