import { Image } from 'expo-image';
import { Link, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/ctx/session';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';

type AlbumRow = {
  id: string;
  title: string | null;
  cover_url: string | null;
  created_at: string;
  photos: { count: number }[] | null;
};

type AlbumsResult = { failed: boolean; albums: AlbumRow[] };

// Row level security scopes this to the signed-in photographer's own albums.
async function fetchAlbums(): Promise<AlbumsResult> {
  const { data, error } = await supabase
    .from('albums')
    .select('id, title, cover_url, created_at, photos!photos_album_id_fkey(count)')
    .or('status.is.null,status.neq.deleted')
    .order('created_at', { ascending: false });

  return { failed: Boolean(error), albums: (data ?? []) as AlbumRow[] };
}

export default function AlbumsScreen() {
  const t = useT();
  const theme = useTheme();
  const { signOut } = useSession();
  const [albums, setAlbums] = useState<AlbumRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);

  function apply(result: AlbumsResult) {
    setFailed(result.failed);
    if (!result.failed) setAlbums(result.albums);
  }

  useEffect(() => {
    let active = true;

    fetchAlbums().then((result) => {
      if (!active) return;
      apply(result);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    apply(await fetchAlbums());
    setRefreshing(false);
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={signOut} accessibilityRole="button" hitSlop={12}>
              <ThemedText type="small" themeColor="textSecondary">
                {t.common.signOut}
              </ThemedText>
            </Pressable>
          ),
        }}
      />

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.accentDeep} />
        </View>
      ) : (
        <FlatList
          data={albums}
          keyExtractor={(album) => album.id}
          contentContainerStyle={styles.list}
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={theme.accentDeep}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <ThemedText type="smallBold">
                {failed ? t.albums.loadError : t.albums.empty}
              </ThemedText>
              {failed ? (
                <Pressable onPress={handleRefresh} accessibilityRole="button" hitSlop={12}>
                  <ThemedText type="small" style={{ color: theme.accentDeep }}>
                    {t.common.retry}
                  </ThemedText>
                </Pressable>
              ) : (
                <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
                  {t.albums.emptyHint}
                </ThemedText>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <Link href={{ pathname: '/album/[id]', params: { id: item.id } }} asChild>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.card,
                  { backgroundColor: theme.surface, borderColor: theme.line },
                  pressed && styles.cardPressed,
                ]}>
                <View style={[styles.cover, { backgroundColor: theme.backgroundElement }]}>
                  {item.cover_url ? (
                    <Image
                      source={{ uri: item.cover_url }}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                      transition={150}
                    />
                  ) : null}
                </View>
                <View style={styles.cardBody}>
                  <ThemedText numberOfLines={1} style={styles.cardTitle}>
                    {item.title?.trim() || t.albums.untitled}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t.albums.photoCount(item.photos?.[0]?.count ?? 0)}
                  </ThemedText>
                </View>
              </Pressable>
            </Link>
          )}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: Spacing.three, gap: Spacing.three, flexGrow: 1 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.six,
  },
  emptyHint: { textAlign: 'center' },
  card: {
    borderWidth: 1,
    borderRadius: Radius.card,
    overflow: 'hidden',
  },
  cardPressed: { opacity: 0.85 },
  cover: { aspectRatio: 16 / 9, width: '100%' },
  cardBody: { padding: Spacing.three, gap: Spacing.half },
  cardTitle: { fontSize: 17, fontWeight: 600 },
});
