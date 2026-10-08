import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { PhotoViewer } from '@/components/photo-viewer';
import { ThemedText } from '@/components/themed-text';
import { HeaderButton, LoadingView, StateView } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useQuery } from '@/hooks/use-query';
import { useTheme } from '@/hooks/use-theme';
import { shareUrl } from '@/lib/config';
import { data, type Photo } from '@/lib/data';
import { describeError, useT } from '@/lib/i18n';

const COLUMNS = 3;
const GAP = 2;

type PhotoList = {
  photos: Photo[];
  nextCursor: string | null;
  status: 'loading' | 'ready' | 'error';
  error: unknown;
};

const INITIAL_LIST: PhotoList = { photos: [], nextCursor: null, status: 'loading', error: null };

export default function AlbumScreen() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();

  // The album itself reloads on focus, so edits made in settings show up.
  const album = useQuery(() => data.fetchAlbum(id));
  const [list, setList] = useState<PhotoList>(INITIAL_LIST);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  useEffect(() => {
    let active = true;

    data
      .fetchPhotos(id)
      .then((page) => {
        if (active) setList({ ...page, status: 'ready', error: null });
      })
      .catch((error: unknown) => {
        if (active) setList({ ...INITIAL_LIST, status: 'error', error });
      });

    return () => {
      active = false;
    };
  }, [id]);

  async function reloadPhotos() {
    try {
      const page = await data.fetchPhotos(id);
      setList({ ...page, status: 'ready', error: null });
    } catch (error) {
      setList((previous) =>
        previous.photos.length > 0 ? previous : { ...INITIAL_LIST, status: 'error', error }
      );
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([album.refresh(), reloadPhotos()]);
    setRefreshing(false);
  }

  async function loadMore() {
    if (loadingMore || !list.nextCursor) return;

    setLoadingMore(true);
    try {
      const page = await data.fetchPhotos(id, list.nextCursor);
      setList((previous) => {
        const known = new Set(previous.photos.map((photo) => photo.id));
        return {
          ...previous,
          photos: [...previous.photos, ...page.photos.filter((photo) => !known.has(photo.id))],
          nextCursor: page.nextCursor,
        };
      });
    } catch {
      // Keep what is on screen; reaching the end again retries.
    } finally {
      setLoadingMore(false);
    }
  }

  const title = album.data?.title?.trim() || (album.data ? t.albums.untitled : '');
  const shareToken = album.data?.shareToken ?? null;

  async function handleShare() {
    if (!shareToken) return;

    const url = shareUrl(shareToken);
    const message = t.album.shareMessage(title);

    try {
      // iOS shares the link as a URL item; Android only reads `message`.
      await Share.share(Platform.OS === 'ios' ? { message, url } : { message: `${message}\n${url}` });
    } catch {
      // The share sheet was dismissed or is unavailable; nothing to recover.
    }
  }

  const tile = (width - GAP * (COLUMNS - 1)) / COLUMNS;
  const total = Math.max(album.data?.photoCount ?? 0, list.photos.length);

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerRight: () => (
            <View style={styles.headerActions}>
              <HeaderButton
                symbol="square.and.arrow.up"
                label={t.album.share}
                onPress={handleShare}
                disabled={!shareToken}
              />
              <HeaderButton
                symbol="gearshape"
                label={t.album.settings}
                onPress={() =>
                  router.push({ pathname: '/album/[id]/settings', params: { id } })
                }
              />
            </View>
          ),
        }}
      />

      {list.status === 'loading' ? (
        <LoadingView />
      ) : (
        <FlatList
          data={list.photos}
          keyExtractor={(photo) => photo.id}
          numColumns={COLUMNS}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.grid}
          contentInsetAdjustmentBehavior="automatic"
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={theme.accentDeep}
            />
          }
          ListHeaderComponent={
            album.data ? (
              <View style={styles.summary}>
                {album.data.description ? (
                  <ThemedText themeColor="textSecondary">{album.data.description}</ThemedText>
                ) : null}
                <ThemedText type="small" themeColor="textSecondary">
                  {t.albums.photoCount(total)}
                  {album.data.isPasswordProtected ? ` · ${t.albums.locked}` : ''}
                </ThemedText>
              </View>
            ) : null
          }
          ListEmptyComponent={
            list.status === 'error' ? (
              <StateView
                title={describeError(t, list.error)}
                actionLabel={t.common.retry}
                onAction={handleRefresh}
              />
            ) : (
              <StateView title={t.album.empty} hint={t.album.emptyHint} />
            )
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footer}>
                <ActivityIndicator color={theme.accentDeep} />
              </View>
            ) : null
          }
          renderItem={({ item, index }) => {
            const uri = item.thumbnailUrl || item.previewUrl;

            return (
              <Pressable
                onPress={() => setViewerIndex(index)}
                accessibilityRole="imagebutton"
                accessibilityLabel={item.filename ?? undefined}
                style={[
                  styles.tile,
                  { width: tile, height: tile, backgroundColor: theme.backgroundElement },
                ]}>
                {uri ? (
                  <Image
                    source={{ uri }}
                    placeholder={item.blurDataUrl ? { uri: item.blurDataUrl } : undefined}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    recyclingKey={item.id}
                    transition={120}
                  />
                ) : null}
                {item.isReady ? null : (
                  <View style={styles.processing}>
                    <ThemedText type="small" style={styles.processingLabel}>
                      {t.album.processing}
                    </ThemedText>
                  </View>
                )}
              </Pressable>
            );
          }}
        />
      )}

      {viewerIndex !== null && list.photos.length > 0 ? (
        <PhotoViewer
          photos={list.photos}
          initialIndex={Math.min(viewerIndex, list.photos.length - 1)}
          total={total}
          onClose={() => setViewerIndex(null)}
          onEndReached={loadMore}
          onSetCover={async (photo) => {
            await data.setAlbumCover(id, photo.id);
            void album.refresh();
          }}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  grid: { flexGrow: 1, gap: GAP },
  row: { gap: GAP },
  summary: { padding: Spacing.three, gap: Spacing.one },
  tile: { overflow: 'hidden' },
  processing: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  processingLabel: { color: '#ffffff' },
  footer: { paddingVertical: Spacing.four },
});
