import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/ctx/session';
import { useTheme } from '@/hooks/use-theme';
import { signInWithGoogle } from '@/lib/auth';
import { isDemoMode } from '@/lib/config';
import { useT } from '@/lib/i18n';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

type Pending = 'password' | 'google' | null;

export default function SignInScreen() {
  const t = useT();
  const theme = useTheme();
  const { enterDemo } = useSession();
  const ready = isDemoMode || isSupabaseConfigured;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState(ready ? '' : t.signIn.notConfigured);

  async function handlePasswordSignIn() {
    if (pending || !ready) return;

    if (isDemoMode) {
      enterDemo();
      return;
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError(t.signIn.missingFields);
      return;
    }

    setPending('password');
    setError('');

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      // On success the session listener swaps this screen for the app.
      if (signInError) {
        setError(
          signInError.code === 'invalid_credentials'
            ? t.signIn.invalidCredentials
            : t.signIn.genericError
        );
      }
    } catch {
      setError(t.signIn.genericError);
    } finally {
      setPending(null);
    }
  }

  async function handleGoogleSignIn() {
    if (pending || !ready) return;

    if (isDemoMode) {
      enterDemo();
      return;
    }

    setPending('google');
    setError('');

    try {
      // Closing the sheet resolves to 'cancelled', which needs no message.
      await signInWithGoogle();
    } catch {
      setError(t.signIn.googleError);
    } finally {
      setPending(null);
    }
  }

  const inputStyle = [
    styles.input,
    { backgroundColor: theme.surface, borderColor: theme.line, color: theme.text },
  ];

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ThemedText style={[styles.brand, { color: theme.accentDeep }]}>
            {t.common.appName}
          </ThemedText>
          <ThemedText type="subtitle" style={styles.title}>
            {t.signIn.title}
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.subtitle}>
            {t.signIn.subtitle}
          </ThemedText>

          <View style={styles.form}>
            <Button
              label={t.signIn.google}
              onPress={handleGoogleSignIn}
              variant="secondary"
              loading={pending === 'google'}
              disabled={!ready || pending === 'password'}
            />

            <View style={styles.divider}>
              <View style={[styles.rule, { backgroundColor: theme.line }]} />
              <ThemedText type="small" themeColor="textSecondary">
                {t.signIn.or}
              </ThemedText>
              <View style={[styles.rule, { backgroundColor: theme.line }]} />
            </View>

            <TextInput
              style={inputStyle}
              value={email}
              onChangeText={setEmail}
              placeholder={t.signIn.email}
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              textContentType="username"
              returnKeyType="next"
              accessibilityLabel={t.signIn.email}
            />
            <TextInput
              style={inputStyle}
              value={password}
              onChangeText={setPassword}
              placeholder={t.signIn.password}
              placeholderTextColor={theme.textSecondary}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={handlePasswordSignIn}
              accessibilityLabel={t.signIn.password}
            />

            {error ? (
              <ThemedText type="small" accessibilityRole="alert" style={{ color: theme.danger }}>
                {error}
              </ThemedText>
            ) : null}

            <Button
              label={pending === 'password' ? t.signIn.submitting : t.signIn.submit}
              onPress={handlePasswordSignIn}
              loading={pending === 'password'}
              disabled={!ready || pending === 'google'}
            />

            {isDemoMode ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.notice}>
                {t.signIn.demoNotice}
              </ThemedText>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
  },
  brand: {
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  title: { marginTop: Spacing.three },
  subtitle: { marginTop: Spacing.two },
  form: { marginTop: Spacing.five, gap: Spacing.three },
  divider: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  notice: { textAlign: 'center' },
});
