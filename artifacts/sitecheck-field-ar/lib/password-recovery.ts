export type PasswordRecoveryStep = 'code' | 'password' | 'complete' | null;

export function recoveryStepAfterCodeVerification(
  currentStep: PasswordRecoveryStep,
  clerkStatus: string | null | undefined,
  errorMessage?: string | null,
): PasswordRecoveryStep {
  if (errorMessage) return currentStep;
  return clerkStatus === 'needs_new_password' ? 'password' : currentStep;
}

export function recoveryStepAfterPasswordSubmission(
  currentStep: PasswordRecoveryStep,
  clerkStatus: string | null | undefined,
  errorMessage?: string | null,
): PasswordRecoveryStep {
  if (errorMessage) return currentStep;
  return clerkStatus === 'complete' ? 'complete' : currentStep;
}

export function passwordRecoverySignInRoute(
  platform: 'native' | 'web',
  scheme: string,
) {
  return platform === 'native' ? `${scheme}:///sign-in` : '/sign-in';
}

export function resetPasswordRecoveryState() {
  return {
    step: null as PasswordRecoveryStep,
    code: '',
    newPassword: '',
    error: null as string | null,
    notice: null as string | null,
  };
}