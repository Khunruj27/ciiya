import { useLinkingURL } from 'expo-linking';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/ctx/session';
import { useTheme } from '@/hooks/use-theme';
import { completeOAuthCallback } from '@/lib/auth';
import { useT } from '@/lib/i18n';

export default function AuthCallbackScreen() {
  const url = useLinkingURL();
  const { reportAuthError } = useSession();
  const theme = useTheme();
  const t = useT();
  const [complete, setComplete] = useState(false);
  useEffect(() => {
    let active = true;
    async function finish() {
      try {
        if (!url || !(await completeOAuthCallback(url))) throw new Error('Missing authentication callback');
      } catch {
        if (active) reportAuthError();
      } finally {
        if (active) setComplete(true);
      }
    }
    void finish();
    return () => { active = false; };
    // Context changes when setSession succeeds; do not restart the callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  if (complete) return <Redirect href="/" />;
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.three, backgroundColor: theme.background }}>
      <ActivityIndicator color={theme.accentDeep} />
      <ThemedText>{t.signIn.submitting}</ThemedText>
    </View>
  );
}
