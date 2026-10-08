import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';

type PhotoRow = {
  id: string;
  thumbnail_url: string | null;
  preview_url: string | null;
  blur_data_url: string | null;
  processing_status: string | null;
};

const COLUMNS = 3;
const GAP = 2;
// First page only for now; paging arrives with the full gallery phase.
const PAGE_SIZE = 150;

type AlbumResult = { failed: boolean; title: string | null; photos: PhotoRow[] };

// Row level security limits both reads to the signed-in photographer's own rows.
async function fetchAlbum(albumId: string): Promise<AlbumResult> {
  const [albumResult, photosResult] = await Promise.all([
    supabase.from('albums').select('title').eq('id', albumId).maybeSingle(),
    supabase
      .from('photos')
      .select('id, thumbnail_url, preview_url, blur_data_url, processing_status')
      .eq('album_id', albumId)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE),
  ]);

  return {
    failed: Boolean(photosResult.error),
    title: albumResult.data?.title ?? null,
    photos: (photosResult.data ?? []) as PhotoRow[],
  };
}

export default function AlbumScreen() {
  const t = useT();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [title, setTitle] = useState('');
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);

  function apply(result: AlbumResult) {
    if (result.title) setTitle(result.title);
    setFailed(result.failed);
    if (!result.failed) setPhotos(result.photos);
  }

  useEffect(() => {
    let active = true;

    fetchAlbum(id).then((result) => {
      if (!active) return;
      apply(result);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [id]);

  async function handleRefresh() {
    setRefreshing(true);
    apply(await fetchAlbum(id));
    setRefreshing(false);
  }

  const tile = (width - GAP * (COLUMNS - 1)) / COLUMNS;

  return (
    <>
      <Stack.Screen options={{ title: title || t.albums.untitled }} />

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.accentDeep} />
        </View>
      ) : (
        <FlatList
          data={photos}
          keyExtractor={(photo) => photo.id}
          numColumns={COLUMNS}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.grid}
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
                {failed ? t.album.loadError : t.album.empty}
              </ThemedText>
              {failed ? (
                <Pressable onPress={handleRefresh} accessibilityRole="button" hitSlop={12}>
                  <ThemedText type="small" style={{ color: theme.accentDeep }}>
                    {t.common.retry}
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
          }
          renderItem={({ item }) => {
            const uri = item.thumbnail_url || item.preview_url;

            return (
              <View
                style={[
                  styles.tile,
                  { width: tile, height: tile, backgroundColor: theme.backgroundElement },
                ]}>
                {uri ? (
                  <Image
                    source={{ uri }}
                    placeholder={item.blur_data_url ? { uri: item.blur_data_url } : undefined}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    recyclingKey={item.id}
                    transition={120}
                  />
                ) : (
                  <ThemedText type="code" themeColor="textSecondary">
                    {t.album.processing}
                  </ThemedText>
                )}
              </View>
            );
          }}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  grid: { flexGrow: 1, gap: GAP },
  row: { gap: GAP },
  tile: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.six,
  },
});
