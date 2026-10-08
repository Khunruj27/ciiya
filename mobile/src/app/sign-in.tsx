import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export default function SignInScreen() {
  const t = useT();
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(isSupabaseConfigured ? '' : t.signIn.notConfigured);

  async function handleSubmit() {
    if (submitting || !isSupabaseConfigured) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError(t.signIn.missingFields);
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      // On success the session listener swaps this screen for the app stack.
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
      setSubmitting(false);
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
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled">
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
              onSubmitEditing={handleSubmit}
              accessibilityLabel={t.signIn.password}
            />

            {error ? (
              <ThemedText
                type="small"
                accessibilityRole="alert"
                style={{ color: theme.danger }}>
                {error}
              </ThemedText>
            ) : null}

            <Pressable
              onPress={handleSubmit}
              disabled={submitting || !isSupabaseConfigured}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: theme.text },
                (pressed || submitting || !isSupabaseConfigured) && styles.buttonDimmed,
              ]}>
              {submitting ? <ActivityIndicator color={theme.onInk} /> : null}
              <ThemedText style={[styles.buttonLabel, { color: theme.onInk }]}>
                {submitting ? t.signIn.submitting : t.signIn.submit}
              </ThemedText>
            </Pressable>
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
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  button: {
    minHeight: 52,
    borderRadius: Radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  buttonDimmed: { opacity: 0.6 },
  buttonLabel: { fontSize: 16, fontWeight: 700 },
});
