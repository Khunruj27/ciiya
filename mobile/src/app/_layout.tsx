import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';
import { SessionProvider, useSession } from '@/ctx/session';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const palette = Colors[isDark ? 'dark' : 'light'];
  const base = isDark ? DarkTheme : DefaultTheme;

  return (
    <ThemeProvider
      value={{
        ...base,
        colors: {
          ...base.colors,
          background: palette.background,
          card: palette.background,
          text: palette.text,
          border: palette.line,
          primary: palette.accentDeep,
        },
      }}>
      <SessionProvider>
        <RootNavigator />
      </SessionProvider>
    </ThemeProvider>
  );
}

function RootNavigator() {
  const { user, isLoading } = useSession();

  // Keep the splash up until the stored session is known, so a signed-in
  // photographer never sees the sign-in screen flash by.
  useEffect(() => {
    if (!isLoading) SplashScreen.hide();
  }, [isLoading]);

  if (isLoading) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={Boolean(user)}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!user}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}
