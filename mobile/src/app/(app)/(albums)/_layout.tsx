import { Stack } from 'expo-router';

import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';

export default function AlbumsLayout() {
  const t = useT();
  const theme = useTheme();

  return (
    <Stack
      screenOptions={{
        headerTintColor: theme.text,
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: theme.background },
      }}>
      <Stack.Screen name="index" options={{ title: t.albums.title, headerLargeTitle: true }} />
      <Stack.Screen name="album/[id]/index" options={{ title: '' }} />
      <Stack.Screen name="album/[id]/settings" options={{ title: t.settings.title }} />
      <Stack.Screen name="album/[id]/access" options={{ title: t.access.title }} />
      <Stack.Screen name="album/[id]/share" options={{ title: t.delivery.title }} />
      <Stack.Screen name="album/[id]/uploads" options={{ title: t.uploads.title }} />
      <Stack.Screen
        name="new-album"
        options={{ title: t.newAlbum.title, presentation: 'modal' }}
      />
    </Stack>
  );
}
