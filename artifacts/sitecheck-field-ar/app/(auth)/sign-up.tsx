import React, { useEffect, useState } from 'react';
import { Link, useRouter } from 'expo-router';
import { useAuth, useSignUp } from '@clerk/expo';
import { Text } from 'react-native';
import { Button } from '@/components/Button';
import { AuthError, AuthField, AuthShell, authStyles } from '@/components/AuthShell';
import { useColors } from '@/hooks/useColors';

export default function SignUpScreen() {
  const colors = useColors();
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const { signUp, errors, fetchStatus } = useSignUp();
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const isLoading = fetchStatus === 'fetching';

  useEffect(() => {
    if (isSignedIn) router.replace('/');
  }, [isSignedIn, router]);

  const finishSignUp = async () => {
    await signUp.finalize({
      navigate: async ({ session }) => {
        if (!session?.currentTask) router.replace('/');
      },
    });
  };

  const handleSubmit = async () => {
    setLocalError(null);
    const result = await signUp.password({
      emailAddress: emailAddress.trim(),
      password,
    });
    if (result.error) {
      setLocalError(result.error.message);
      return;
    }
    await signUp.verifications.sendEmailCode();
  };

  const handleVerify = async () => {
    setLocalError(null);
    const result = await signUp.verifications.verifyEmailCode({ code });
    if (result.error) {
      setLocalError(result.error.message);
      return;
    }
    if (signUp.status === 'complete') await finishSignUp();
  };

  const clerkError = errors?.fields?.emailAddress?.message
    || errors?.fields?.password?.message
    || errors?.fields?.code?.message
    || errors?.global?.[0]?.message
    || null;

  if (signUp.status === 'missing_requirements' && signUp.unverifiedFields.includes('email_address')) {
    return (
      <AuthShell
        eyebrow="SITEcheck FIELD AR"
        title="Verify your account"
        description="Enter the one-time code sent to your email to finish creating your inspector account."
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
        <Button title="Send a new code" onPress={() => signUp.verifications.sendEmailCode()} variant="outline" disabled={isLoading} style={{ marginTop: 10 }} />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="SITEcheck FIELD AR"
      title="Create inspector account"
      description="Use a secure account so inspection access and field evidence stay separated by user."
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
        placeholder="At least 8 characters"
        secureTextEntry
        autoComplete="new-password"
      />
      <AuthError message={localError || clerkError} />
      <Button
        title="Create account"
        onPress={handleSubmit}
        loading={isLoading}
        disabled={!emailAddress.trim() || !password}
        testID="field-sign-up-btn"
      />
      <Text style={[authStyles.linkText, { color: colors.mutedForeground, marginTop: 18, textAlign: 'center' }]}>
        Verification is required before field data can be loaded.
      </Text>
      <Text
        onPress={() => router.push('/(auth)/sign-in')}
        style={[authStyles.linkText, { color: colors.primary, marginTop: 18, textAlign: 'center' }]}
      >
        Already have an account? Sign in
      </Text>
    </AuthShell>
  );
}