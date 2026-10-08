import { Stack } from 'expo-router';

import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';

export default function AccountLayout() {
  const t = useT();
  const theme = useTheme();

  return (
    <Stack
      screenOptions={{
        headerTintColor: theme.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.background },
      }}>
      <Stack.Screen name="index" options={{ title: t.account.title, headerLargeTitle: true }} />
    </Stack>
  );
}
