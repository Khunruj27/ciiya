import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { UploadBanner } from '@/components/upload-banner';
import { UploadSheet } from '@/components/upload-sheet';
import { Spacing } from '@/constants/theme';
import { useQuery } from '@/hooks/use-query';
import { useTheme } from '@/hooks/use-theme';
import { useAlbumUploads } from '@/hooks/use-uploads';
import { shareUrl } from '@/lib/config';
import { data, type Photo, type PhotoPage } from '@/lib/data';
import { describeError, useT } from '@/lib/i18n';
import { clearFinishedUploads, retryFailedUploads } from '@/lib/uploads/queue';

const COLUMNS = 3;
const GAP = 2;
// Bounds how much is copied into the app at once; more can be added right after.
const MAX_PHOTOS_PER_PICK = 100;
// How soon after an upload lands the grid picks it up.
const UPLOAD_REFRESH_MS = 1500;
// While new photos are processing, check on them this often, for this long.
const PROCESSING_POLL_MS = 5000;
const MAX_PROCESSING_POLLS = 36;
// Lets the photo picker finish closing before the upload sheet opens over it.
const SHEET_DELAY_MS = 450;

type PhotoList = {
  photos: Photo[];
  nextCursor: string | null;
  status: 'loading' | 'ready' | 'error';
  error: unknown;
};

const INITIAL_LIST: PhotoList = { photos: [], nextCursor: null, status: 'loading', error: null };

/**
 * Folds a fresh first page into the list: new photos go on top and known ones
 * pick up their latest state, without dropping older pages already scrolled in.
 */
function mergeLatest(previous: PhotoList, page: PhotoPage): PhotoList {
  if (previous.status !== 'ready' || previous.photos.length === 0) {
    return { ...page, status: 'ready', error: null };
  }

  const fresh = new Map(page.photos.map((photo) => [photo.id, photo]));
  const known = new Set(previous.photos.map((photo) => photo.id));

  return {
    ...previous,
    photos: [
      ...page.photos.filter((photo) => !known.has(photo.id)),
      ...previous.photos.map((photo) => fresh.get(photo.id) ?? photo),
    ],
  };
}

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
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<ImagePicker.ImagePickerAsset[] | null>(null);
  const isFocused = useIsFocused();
  const { summary: uploads } = useAlbumUploads(id);
  const refreshAlbum = album.refresh;

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

  // Uploads that land show up in the grid without a manual refresh. One refresh
  // covers everything that finished in the meantime, however fast they arrive.
  const finishedUploads = uploads.finished;
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (finishedUploads === 0 || refreshTimer.current) return;

    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void refreshAlbum();
      data
        .fetchPhotos(id)
        .then((page) => setList((previous) => mergeLatest(previous, page)))
        .catch(() => {
          // The grid keeps what it has; pull to refresh still works.
        });
    }, UPLOAD_REFRESH_MS);
  }, [finishedUploads, id, refreshAlbum]);

  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    []
  );

  // Photos still being processed turn into thumbnails on their own.
  const processingKey = list.photos
    .filter((photo) => !photo.isReady)
    .map((photo) => photo.id)
    .join(',');
  useEffect(() => {
    if (!processingKey || !isFocused) return;

    let active = true;
    let polls = 0;
    const timer = setInterval(() => {
      polls += 1;
      if (polls > MAX_PROCESSING_POLLS) {
        clearInterval(timer);
        return;
      }

      data
        .fetchPhotos(id)
        .then((page) => {
          if (active) setList((previous) => mergeLatest(previous, page));
        })
        .catch(() => {
          // Try again on the next tick.
        });
    }, PROCESSING_POLL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [processingKey, isFocused, id]);

  async function handleAddPhotos() {
    if (picking || picked) return;

    setPicking(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: MAX_PHOTOS_PER_PICK,
        orderedSelection: true,
        quality: 1,
        // Hand back each original file untouched instead of a re-encoded copy.
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
      });

      if (!result.canceled && result.assets.length > 0) {
        const assets = result.assets;
        setTimeout(() => setPicked(assets), SHEET_DELAY_MS);
      }
    } catch {
      Alert.alert(t.uploads.pickFailed);
    } finally {
      setPicking(false);
    }
  }

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
                symbol="plus"
                label={t.uploads.add}
                onPress={handleAddPhotos}
                disabled={!album.data || picking}
              />
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
              <>
                <View style={styles.summary}>
                  {album.data.description ? (
                    <ThemedText themeColor="textSecondary">{album.data.description}</ThemedText>
                  ) : null}
                  <ThemedText type="small" themeColor="textSecondary">
                    {t.albums.photoCount(total)}
                    {album.data.isPasswordProtected ? ` · ${t.albums.locked}` : ''}
                  </ThemedText>
                </View>
                <UploadBanner
                  summary={uploads}
                  onOpen={() => router.push({ pathname: '/album/[id]/uploads', params: { id } })}
                  onRetry={() => retryFailedUploads(id)}
                  onDismiss={() => clearFinishedUploads(id)}
                />
              </>
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

      {picked && album.data ? (
        <UploadSheet album={album.data} assets={picked} onClose={() => setPicked(null)} />
      ) : null}

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
