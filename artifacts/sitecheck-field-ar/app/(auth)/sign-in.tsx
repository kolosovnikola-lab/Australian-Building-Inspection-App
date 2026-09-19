import React, { useCallback, useEffect, useState } from 'react';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth, useSignIn, useSSO } from '@clerk/expo';
import { Feather } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { AuthError, AuthField, AuthNotice, AuthShell, authStyles } from '@/components/AuthShell';
import { useColors } from '@/hooks/useColors';
import {
  recoveryStepAfterCodeVerification,
  recoveryStepAfterPasswordSubmission,
  resetPasswordRecoveryState,
  type PasswordRecoveryStep,
} from '@/lib/password-recovery';

WebBrowser.maybeCompleteAuthSession();

export default function SignInScreen() {
  const colors = useColors();
  const router = useRouter();
  const { reason } = useLocalSearchParams<{ reason?: string }>();
  const { isSignedIn } = useAuth();
  const { signIn, errors, fetchStatus } = useSignIn();
  const { startSSOFlow } = useSSO();
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [resetStep, setResetStep] = useState<PasswordRecoveryStep>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isResendingResetCode, setIsResendingResetCode] = useState(false);
  const [suppressStaleCodeError, setSuppressStaleCodeError] = useState(false);
  const isLoading = fetchStatus === 'fetching';

  useEffect(() => {
    if (isSignedIn) router.replace('/');
  }, [isSignedIn, router]);

  const finishSignIn = useCallback(async () => {
    await signIn.finalize({
      navigate: async ({ session }) => {
        if (!session?.currentTask) router.replace('/');
      },
    });
  }, [router, signIn]);

  const handlePasswordSignIn = async () => {
    setLocalError(null);
    const result = await signIn.password({
      emailAddress: emailAddress.trim(),
      password,
    });
    if (result.error) {
      setLocalError(result.error.message);
      return;
    }
    if (signIn.status === 'complete') {
      await finishSignIn();
      return;
    }
    if (signIn.status === 'needs_client_trust') {
      const emailCodeFactor = signIn.supportedSecondFactors.find(
        (factor) => factor.strategy === 'email_code',
      );
      if (emailCodeFactor) await signIn.mfa.sendEmailCode();
    }
  };

  const handleRequestPasswordReset = async () => {
    setLocalError(null);
    setResetSuccess(null);
    setCode('');
    setSuppressStaleCodeError(false);
    if (!emailAddress.trim()) {
      setLocalError('Enter your email address first.');
      return;
    }
    try {
      const result = await signIn.create({ identifier: emailAddress.trim() });
      if (result.error) {
        setLocalError(result.error.message);
        return;
      }
      const codeResult = await signIn.resetPasswordEmailCode.sendCode();
      if (codeResult.error) {
        setLocalError(codeResult.error.message);
        return;
      }
      setResetStep('code');
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Could not send a password reset code.');
    }
  };

  const handleVerifyResetCode = async () => {
    setLocalError(null);
    setResetSuccess(null);
    setSuppressStaleCodeError(false);
    const result = await signIn.resetPasswordEmailCode.verifyCode({ code: code.trim() });
    if (result.error) {
      setResetStep((current) => recoveryStepAfterCodeVerification(current, signIn.status, result.error?.message));
      setLocalError(result.error.message);
      return;
    }
    setResetStep((current) => recoveryStepAfterCodeVerification(current, signIn.status));
  };

  const handleResendResetCode = async () => {
    setCode('');
    setLocalError(null);
    setResetSuccess(null);
    setSuppressStaleCodeError(true);
    setIsResendingResetCode(true);
    try {
      const result = await signIn.resetPasswordEmailCode.sendCode();
      if (result.error) {
        setLocalError(result.error.message);
        return;
      }
      setResetSuccess(`A new reset code was sent to ${emailAddress.trim()}.`);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Could not send a new password reset code.');
    } finally {
      setIsResendingResetCode(false);
    }
  };

  const handleSetNewPassword = async () => {
    setLocalError(null);
    setResetSuccess(null);
    const result = await signIn.resetPasswordEmailCode.submitPassword({ password: newPassword });
    if (result.error) {
      setResetStep((current) => recoveryStepAfterPasswordSubmission(current, signIn.status, result.error?.message));
      setLocalError(result.error.message);
      return;
    }
    const nextStep = recoveryStepAfterPasswordSubmission(resetStep, signIn.status);
    setResetStep(nextStep);
    if (nextStep === 'complete') {
      setResetSuccess('Your password has been updated. Sign in with the new password to return to your inspections.');
      setNewPassword('');
      setCode('');
    }
  };

  const returnToSignIn = () => {
    const reset = resetPasswordRecoveryState();
    setResetStep(reset.step);
    setResetSuccess(reset.notice);
    setLocalError(reset.error);
    setCode(reset.code);
    setNewPassword(reset.newPassword);
    setPassword('');
    setSuppressStaleCodeError(false);
  };

  const handleVerify = async () => {
    setLocalError(null);
    const result = await signIn.mfa.verifyEmailCode({ code });
    if (result.error) {
      setLocalError(result.error.message);
      return;
    }
    if (signIn.status === 'complete') await finishSignIn();
  };

  const handleGoogleSignIn = async () => {
    setLocalError(null);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: 'oauth_google',
        redirectUrl: AuthSession.makeRedirectUri({ scheme: 'sitecheck-field-ar' }),
      });
      if (createdSessionId) {
        await setActive?.({ session: createdSessionId });
        router.replace('/');
      } else {
        setLocalError('Google sign-in needs one more step. Please try again.');
      }
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Google sign-in failed.');
    }
  };

  const clerkError = errors?.fields?.identifier?.message
    || errors?.fields?.password?.message
    || errors?.fields?.code?.message
    || errors?.global?.[0]?.message
    || null;

  if (signIn.status === 'needs_client_trust') {
    return (
      <AuthShell
        eyebrow="SITEcheck FIELD AR"
        title="Verify your sign-in"
        description="Enter the code sent to your email to continue securely."
      >
        <AuthField
          label="Verification code"
          value={code}
          onChangeText={setCode}
          placeholder="123456"
          keyboardType="number-pad"
        />
        <AuthError message={localError || clerkError} />
        <Button title="Verify and continue" onPress={handleVerify} loading={isLoading} disabled={!code} />
      </AuthShell>
    );
  }

  if (resetStep === 'code') {
    return (
      <AuthShell
        eyebrow="SITEcheck FIELD AR"
        title="Check your email"
        description={`Enter the reset code sent to ${emailAddress.trim()}.`}
      >
        <AuthField
          label="Reset code"
          value={code}
          onChangeText={setCode}
          placeholder="123456"
          keyboardType="number-pad"
        />
        <AuthError message={localError || (suppressStaleCodeError ? null : clerkError)} />
        <AuthNotice message={resetSuccess} />
        <Button
          title="Verify code"
          onPress={handleVerifyResetCode}
          loading={isLoading && !isResendingResetCode}
          disabled={!code.trim() || isResendingResetCode}
          testID="field-password-reset-verify-btn"
        />
        <Button
          title="Send a new code"
          onPress={handleResendResetCode}
          variant="outline"
          loading={isResendingResetCode}
          disabled={isLoading && !isResendingResetCode}
          style={{ marginTop: 10 }}
          testID="field-password-reset-resend-btn"
        />
        <Pressable onPress={() => setResetStep(null)} style={authStyles.linkRow}>
          <Text style={[authStyles.linkText, { color: colors.primary }]}>Back to sign in</Text>
        </Pressable>
      </AuthShell>
    );
  }

  if (resetStep === 'password') {
    return (
      <AuthShell
        eyebrow="SITEcheck FIELD AR"
        title="Choose a new password"
        description="Use a strong password you have not used for another account."
      >
        <AuthField
          label="New password"
          value={newPassword}
          onChangeText={setNewPassword}
          placeholder="New password"
          secureTextEntry
          autoComplete="new-password"
        />
        <AuthError message={localError || clerkError} />
        <Button title="Save new password" onPress={handleSetNewPassword} loading={isLoading} disabled={!newPassword} />
      </AuthShell>
    );
  }

  if (resetStep === 'complete') {
    return (
      <AuthShell
        eyebrow="SITEcheck FIELD AR"
        title="Password updated"
        description={resetSuccess ?? 'Your password was updated securely.'}
      >
        <Button title="Return to sign in" onPress={returnToSignIn} testID="field-password-reset-complete-btn" />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="SITEcheck FIELD AR"
      title="Inspector sign in"
      description="Sign in to load assigned inspections and keep field evidence tied to your account."
    >
      <AuthField
        label="Email address"
        value={emailAddress}
        onChangeText={setEmailAddress}
        placeholder="you@company.com"
        keyboardType="email-address"
        autoComplete="email"
      />
      <AuthField
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="Your password"
        secureTextEntry
        autoComplete="password"
      />
      <AuthNotice
        message={reason === 'session_expired'
          ? 'Your previous capture was not saved. Sign in again to continue safely.'
          : null}
      />
      <AuthError message={localError || clerkError || resetSuccess} />
      <Button
        title="Sign in"
        onPress={handlePasswordSignIn}
        loading={isLoading}
        disabled={!emailAddress.trim() || !password}
        testID="field-sign-in-btn"
      />
      <Pressable onPress={handleRequestPasswordReset} disabled={isLoading} style={authStyles.linkRow}>
        <Text style={[authStyles.linkText, { color: colors.primary }]}>Forgot password?</Text>
      </Pressable>
      <ViewDivider />
      <Pressable
        onPress={handleGoogleSignIn}
        disabled={isLoading}
        style={({ pressed }) => ({
          alignItems: 'center',
          borderColor: colors.border,
          borderRadius: 12,
          borderWidth: 1,
          flexDirection: 'row',
          justifyContent: 'center',
          minHeight: 50,
          opacity: pressed || isLoading ? 0.7 : 1,
        })}
      >
        {isLoading ? <ActivityIndicator color={colors.foreground} /> : <Feather name="globe" size={17} color={colors.foreground} />}
        <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 15, marginLeft: 8 }}>
          Continue with Google
        </Text>
      </Pressable>
      <Pressable onPress={() => router.push('/(auth)/sign-up')} style={authStyles.linkRow}>
        <Text style={[authStyles.linkText, { color: colors.mutedForeground }]}>Need an account? </Text>
        <Text style={[authStyles.linkText, { color: colors.primary }]}>Create one</Text>
      </Pressable>
    </AuthShell>
  );
}

function ViewDivider() {
  const colors = useColors();
  return (
    <View style={authStyles.divider}>
      <View style={[authStyles.dividerLine, { backgroundColor: colors.border }]} />
      <Text style={[authStyles.dividerText, { color: colors.mutedForeground }]}>OR</Text>
      <View style={[authStyles.dividerLine, { backgroundColor: colors.border }]} />
    </View>
  );
}