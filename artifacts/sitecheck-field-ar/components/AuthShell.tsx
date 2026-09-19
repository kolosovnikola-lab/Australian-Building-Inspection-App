import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

export function AuthShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.logo, { backgroundColor: colors.primary }]}>
          <Feather name="home" size={28} color={colors.primaryForeground} />
        </View>
        <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>{eyebrow}</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.description, { color: colors.mutedForeground }]}>{description}</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {children}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function AuthField({ label, ...props }: TextInputProps & { label: string }) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
      <TextInput
        {...props}
        style={[
          styles.input,
          { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.input },
          props.style,
        ]}
        placeholderTextColor={colors.mutedForeground}
        autoCapitalize={props.autoCapitalize ?? 'none'}
      />
    </View>
  );
}

export function AuthError({ message }: { message: string | null }) {
  const colors = useColors();
  if (!message) return null;
  return (
    <Text style={[styles.error, { color: colors.destructive }]} accessibilityRole="alert">
      {message}
    </Text>
  );
}

export function AuthNotice({ message }: { message: string | null }) {
  const colors = useColors();
  if (!message) return null;
  return (
    <Text
      style={[styles.notice, { color: colors.primary }]}
      accessibilityRole="alert"
    >
      {message}
    </Text>
  );
}

export const authStyles = StyleSheet.create({
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 22,
  },
  linkText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 18,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
});

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  logo: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: 16,
    justifyContent: 'center',
    height: 64,
    marginBottom: 18,
    width: 64,
  },
  eyebrow: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    letterSpacing: 1.6,
    textAlign: 'center',
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 32,
    letterSpacing: -0.7,
    marginTop: 8,
    textAlign: 'center',
  },
  description: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 22,
    marginHorizontal: 10,
    marginTop: 10,
    textAlign: 'center',
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 28,
    padding: 20,
  },
  field: {
    marginBottom: 16,
  },
  label: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    marginBottom: 7,
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    minHeight: 50,
    paddingHorizontal: 14,
  },
  error: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
  notice: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
});