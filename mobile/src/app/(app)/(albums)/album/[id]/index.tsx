import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { PhotoViewer } from '@/components/photo-viewer';
import { ThemedText } from '@/components/themed-text';
import { Button, HeaderButton, LoadingView, Segmented, StateView } from '@/components/ui';
import { UploadBanner } from '@/components/upload-banner';
import { UploadSheet } from '@/components/upload-sheet';
import { Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/ctx/session';
import { useAlbumCoverGuard } from '@/hooks/use-album-cover-guard';
import { useQuery } from '@/hooks/use-query';
import { useTheme } from '@/hooks/use-theme';
import { useAlbumUploads } from '@/hooks/use-uploads';
import { isAlbumEditingAvailable } from '@/lib/album-edit-release';
import { isPhotoRetryAvailable } from '@/lib/photo-retry-release';
import { MAX_PHOTO_RETRIES_PER_TAP, retryablePhotos, retryPhotos } from '@/lib/photo-retry';
import { data, DataError } from '@/lib/data';
import { photoProcessing, shouldPollPhoto } from '@/lib/data/types';
import { PhotoFeed } from '@/lib/data/photo-feed';
import {
  frozenPhotoSelection,
  isPhotoBrowseFiltered,
  loadedPhotoReadiness,
  loadedProcessingCounts,
  selectPhotos,
  type PhotoReadinessFilter,
} from '@/lib/data/photo-browse';
import { describeError, photoProcessingText, useT } from '@/lib/i18n';
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
const noFilteredPrefetch = () => {};

type ViewerSelection = {
  version: number;
  albumId: string;
  photoId: string;
  /** Null retains the existing all-photos paging; filtered sessions freeze IDs. */
  photoIds: string[] | null;
  lifetime: () => (() => boolean) | null;
};

export default function AlbumScreen() {
  const { user } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  if (!user?.id) return <StateView title={t.common.errorSession} />;
  return <OwnedAlbumScreen key={`${user.id}:${id}`} id={id} />;
}

function OwnedAlbumScreen({ id }: { id: string }) {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();

  // The album itself reloads on focus, so edits made in settings show up.
  const album = useQuery(() => data.fetchAlbum(id));
  const feed = useMemo(() => new PhotoFeed({
    fetchPage: (cursor) => data.fetchPhotos(id, cursor),
    fetchUpdates: (ids) => data.fetchPhotoUpdates(id, ids),
  }), [id]);
  const list = useSyncExternalStore(feed.subscribe, feed.getSnapshot, feed.getSnapshot);
  const { loadingMore, refreshing } = list;
  const [viewer, setViewer] = useState<ViewerSelection | null>(null);
  const viewerSequence = useRef(0);
  const viewerRef = useRef<ViewerSelection | null>(null);
  useLayoutEffect(() => { viewerRef.current = viewer; }, [viewer]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PhotoReadinessFilter>('all');
  const browseContext = useMemo(() => ({ query, filter }), [query, filter]);
  const browseContextRef = useRef(browseContext);
  useLayoutEffect(() => { browseContextRef.current = browseContext; }, [browseContext]);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<ImagePicker.ImagePickerAsset[] | null>(null);
  const isFocused = useIsFocused();
  const coverGuard = useAlbumCoverGuard(id, isFocused);
  const visiblePhotos = useMemo(() => selectPhotos(list.photos, query, filter), [list.photos, query, filter]);
  const filtered = isPhotoBrowseFiltered(query, filter);
  const readiness = loadedPhotoReadiness(list.photos);
  const processingCounts = loadedProcessingCounts(list.photos);
  const hasMore = Boolean(list.nextCursor);
  const viewerPhotos = useMemo(() => viewer?.photoIds
    ? frozenPhotoSelection(viewer.photoIds, list.photos) : list.photos, [viewer, list.photos]);
  const selectedIndex = viewer?.albumId === id && viewer.lifetime === coverGuard.capture &&
    isFocused && coverGuard.available
    ? viewerPhotos.findIndex(photo => photo.id === viewer.photoId) : -1;
  const viewerIndex = selectedIndex >= 0 ? selectedIndex : null;
  const { summary: uploads } = useAlbumUploads(id);
  const refreshAlbum = album.refresh;
  const failedPhotos = useMemo(() => retryablePhotos(list.photos), [list.photos]);
  const [retryProgress, setRetryProgress] = useState<{ done: number; total: number } | null>(null);
  // Synchronous single-flight: a double tap must not start two batches.
  const retryingRef = useRef(false);

  useEffect(() => {
    void feed.reload();
    return feed.dispose;
  }, [feed]);

  useEffect(() => feed.subscribe(() => {
    const active = viewerRef.current;
    if (!active) return;
    const fresh = feed.getSnapshot().photos;
    if (!fresh.some(photo => photo.id === active.photoId) ||
      (active.photoIds && frozenPhotoSelection(active.photoIds, fresh).length === 0)) {
      // Permanently dismiss a vanished selection before React renders. An ID
      // returning later must not resurrect a pager or a queued cover action.
      viewerRef.current = null;
      setViewer(null);
    }
  }), [feed]);

  function resetBrowse() { setQuery(''); setFilter('all'); }

  function openPhoto(photoId: string) {
    const current = coverGuard.capture();
    if (!current?.() || browseContextRef.current !== browseContext) return;
    const fresh = selectPhotos(feed.getSnapshot().photos, query, filter);
    if (!fresh.some(photo => photo.id === photoId)) return;
    const selection: ViewerSelection = {
      version: ++viewerSequence.current,
      albumId: id, photoId, photoIds: filtered ? fresh.map(photo => photo.id) : null,
      lifetime: coverGuard.capture,
    };
    viewerRef.current = selection;
    setViewer(selection);
  }

  function closeViewer() { viewerRef.current = null; setViewer(null); }

  // Uploads that land show up in the grid without a manual refresh. One refresh
  // covers everything that finished in the meantime, however fast they arrive.
  const finishedUploads = uploads.finished;
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Keep the lightbox's numeric swipe position stable. Completed uploads
    // refresh immediately after it closes; targeted processing updates can
    // still fill previews without changing photo order while it is open.
    if (finishedUploads === 0 || !isFocused || viewerIndex !== null) return;

    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void refreshAlbum();
      void feed.refreshLatest();
    }, UPLOAD_REFRESH_MS);
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    };
  }, [finishedUploads, isFocused, viewerIndex, refreshAlbum, feed]);

  // Photos still being processed turn into thumbnails on their own.
  const processingKey = list.photos
    .filter(shouldPollPhoto)
    .map((photo) => photo.id)
    .join(',');
  useEffect(() => {
    if (!processingKey || !isFocused) return;

    let polls = 0;
    const timer = setInterval(() => {
      polls += 1;
      if (polls > MAX_PROCESSING_POLLS) {
        clearInterval(timer);
        return;
      }

      // Update pending IDs from all loaded pages, not only the first 60 photos.
      // The feed bounds requests and prevents overlapping/stale polling.
      void feed.refreshProcessing();
    }, PROCESSING_POLL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [processingKey, isFocused, feed]);

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

  function confirmRetryFailed() {
    const current = coverGuard.capture();
    if (!current?.() || retryingRef.current || !isPhotoRetryAvailable()) return;
    const ids = retryablePhotos(feed.getSnapshot().photos).map((photo) => photo.id)
      .slice(0, MAX_PHOTO_RETRIES_PER_TAP);
    if (!ids.length) return;

    Alert.alert(t.album.retryFailedTitle, t.album.retryFailedMessage(ids.length), [
      { text: t.common.cancel, style: 'cancel' },
      { text: t.album.retryFailedConfirm, onPress: () => { void runRetry(ids, current); } },
    ]);
  }

  async function runRetry(ids: string[], isCurrent: () => boolean) {
    // The dialog may outlive its visit: re-check before sending anything.
    if (!isCurrent() || retryingRef.current) return;
    retryingRef.current = true;
    setRetryProgress({ done: 0, total: ids.length });
    try {
      const summary = await retryPhotos({
        photoIds: ids,
        retry: (photoId) => data.retryPhotoProcessing(id, photoId),
        isCurrent,
        onProgress: (done, total) => setRetryProgress({ done, total }),
      });
      if (!isCurrent()) return;
      feed.markRequeued(summary.queued);
      const lines = [
        summary.queued.length ? t.album.retryFailedQueued(summary.queued.length) : null,
        summary.alreadyQueued ? t.album.retryFailedAlready(summary.alreadyQueued) : null,
        summary.sourceMissing ? t.album.retryFailedMissing(summary.sourceMissing) : null,
        summary.notRetryable ? t.album.retryFailedNotRetryable(summary.notRetryable) : null,
        summary.failed ? t.album.retryFailedErrors(summary.failed) : null,
        summary.skipped ? t.album.retryFailedStopped(summary.skipped) : null,
      ].filter((line): line is string => Boolean(line));
      Alert.alert(t.album.retryFailedDoneTitle, lines.join('\n'));
      // Photos that were not failed here any more get their real state now.
      if (summary.notRetryable || summary.alreadyQueued) void feed.refreshProcessing();
    } finally {
      retryingRef.current = false;
      if (isCurrent()) setRetryProgress(null);
    }
  }

  async function handleRefresh() {
    const current = coverGuard.capture();
    if (!current?.()) return;
    closeViewer();
    await Promise.all([album.refresh(), feed.reload(true)]);
  }

  async function loadMore() {
    const current = coverGuard.capture();
    if (!current?.()) return;
    await feed.loadMore();
  }

  const title = album.data?.title?.trim() || (album.data ? t.albums.untitled : '');
  const shareToken = album.data?.shareToken ?? null;
  const refreshError = list.errorSource === 'latest' && list.photos.length ? list.error : album.error;

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
                onPress={() => router.push({ pathname: '/album/[id]/share', params: { id } })}
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
          data={visiblePhotos}
          keyExtractor={(photo) => photo.id}
          numColumns={COLUMNS}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.grid}
          contentInsetAdjustmentBehavior="automatic"
          // A short/no-match filtered list must not silently drain every page.
          onEndReached={filtered ? undefined : loadMore}
          onEndReachedThreshold={0.6}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={theme.accentDeep}
            />
          }
          ListHeaderComponent={
            <>
              {refreshError ? (
                <StateView
                  title={describeError(t, refreshError)}
                  actionLabel={refreshing ? undefined : t.common.retry}
                  onAction={handleRefresh}
                />
              ) : null}
              {album.data ? (
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
                  <View style={styles.tools}>
                    <View style={[styles.search, { backgroundColor: theme.surface, borderColor: theme.line }]}>
                      <TextInput
                        value={query} onChangeText={setQuery}
                        placeholder={t.album.searchPhotos} accessibilityLabel={t.album.searchPhotos}
                        placeholderTextColor={theme.textSecondary}
                        style={[styles.searchInput, { color: theme.text }]}
                        inputMode="search" returnKeyType="search" autoCorrect={false}
                        autoCapitalize="none" maxLength={200}
                      />
                      {query ? (
                        <Pressable onPress={() => setQuery('')} accessibilityRole="button"
                          accessibilityLabel={t.album.clearPhotoSearch} style={styles.clear}>
                          <ThemedText themeColor="textSecondary">×</ThemedText>
                        </Pressable>
                      ) : null}
                    </View>
                    <Segmented<PhotoReadinessFilter> value={filter} onChange={setFilter} options={[
                      { value: 'all', label: t.album.filterAll },
                      { value: 'ready', label: t.album.filterReady },
                      { value: 'not-ready', label: t.album.filterNotReady },
                      { value: 'failed', label: t.album.filterFailed },
                    ]} />
                    <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">
                      {t.album.loadedSearchCount(visiblePhotos.length, readiness.loaded)}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {t.album.photoReadiness(readiness.ready, readiness.notReady)}
                    </ThemedText>
                    {processingCounts.waiting + processingCounts.working + processingCounts.failed > 0 ? (
                      <ThemedText type="small" themeColor="textSecondary">
                        {t.album.processingCounts(processingCounts.waiting, processingCounts.working, processingCounts.failed)}
                      </ThemedText>
                    ) : null}
                    {processingCounts.unknown > 0 ? (
                      <ThemedText type="small" themeColor="textSecondary">
                        {t.album.processingUnknown(processingCounts.unknown)}
                      </ThemedText>
                    ) : null}
                    {processingCounts.stopped > 0 ? (
                      <ThemedText type="small" themeColor="textSecondary">
                        {t.album.processingStoppedCount(processingCounts.stopped)}
                      </ThemedText>
                    ) : null}
                    {processingCounts.preparing > 0 ? (
                      <ThemedText type="small" themeColor="textSecondary">
                        {t.album.processingPreviewCount(processingCounts.preparing)}
                      </ThemedText>
                    ) : null}
                    {list.processingError ? (
                      <ThemedText type="small" accessibilityRole="alert" style={{ color: theme.danger }}>
                        {t.album.processingReadFailed}
                      </ThemedText>
                    ) : null}
                    {isPhotoRetryAvailable() && (failedPhotos.length > 0 || retryProgress) ? (
                      <Button
                        label={retryProgress
                          ? t.album.retryFailedProgress(retryProgress.done, retryProgress.total)
                          : failedPhotos.length > MAX_PHOTO_RETRIES_PER_TAP
                            ? t.album.retryFailedLimited(failedPhotos.length, MAX_PHOTO_RETRIES_PER_TAP)
                            : t.album.retryFailed(failedPhotos.length)}
                        onPress={confirmRetryFailed}
                        loading={retryProgress !== null}
                        disabled={retryProgress !== null || !coverGuard.available}
                      />
                    ) : null}
                    {readiness.notReady > 0 || list.processingError ? (
                      <Button label={t.album.processingRefresh} onPress={handleRefresh} variant="secondary"
                        loading={refreshing} disabled={!coverGuard.available} />
                    ) : null}
                    <ThemedText type="small" themeColor="textSecondary">{t.album.localSearchHint}</ThemedText>
                    {hasMore ? (
                      <ThemedText type="small" themeColor="textSecondary">{t.album.morePhotosHint}</ThemedText>
                    ) : null}
                  </View>
                  <UploadBanner
                    summary={uploads}
                    onOpen={() => router.push({ pathname: '/album/[id]/uploads', params: { id } })}
                    onRetry={() => retryFailedUploads(id)}
                    onDismiss={() => clearFinishedUploads(id)}
                  />
                </>
              ) : null}
            </>
          }
          ListEmptyComponent={
            list.status === 'error' ? (
              <StateView
                title={describeError(t, list.error)}
                actionLabel={t.common.retry}
                onAction={handleRefresh}
              />
            ) : filtered && list.photos.length > 0 ? (
              <StateView title={t.album.noPhotoResults} hint={t.album.noPhotoResultsHint}
                actionLabel={t.album.resetPhotoFilters} onAction={resetBrowse} />
            ) : (
              <StateView title={t.album.empty} hint={t.album.emptyHint} />
            )
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footer}>
                <ActivityIndicator color={theme.accentDeep} />
              </View>
            ) : list.errorSource === 'more' ? (
              <StateView
                title={describeError(t, list.error)}
                actionLabel={t.common.retry}
                onAction={loadMore}
              />
            ) : hasMore && filtered ? (
              <View style={styles.footer}>
                <Button label={t.album.loadMorePhotos} onPress={loadMore} variant="secondary"
                  disabled={refreshing || !coverGuard.available} />
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            const uri = item.thumbnailUrl || item.previewUrl;
            const processing = photoProcessing(item);
            const statusLabel = photoProcessingText(t, item);

            return (
              <Pressable
                onPress={() => openPhoto(item.id)}
                accessibilityRole="imagebutton"
                accessibilityLabel={[item.filename, statusLabel].filter(Boolean).join(' · ')}
                accessibilityState={{ busy: processing.status === 'processing' }}
                accessibilityValue={processing.progress === null ? undefined
                  : { min: 0, max: 100, now: processing.progress }}
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
                  <View style={[styles.processing, processing.status === 'failed' && styles.failedProcessing]}>
                    <ThemedText type="small" style={styles.processingLabel}>
                      {statusLabel}
                    </ThemedText>
                    {processing.progress !== null ? (
                      <View style={styles.processingTrack}>
                        <View style={[styles.processingFill, { width: `${processing.progress}%` }]} />
                      </View>
                    ) : null}
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

      {viewerIndex !== null && viewerPhotos.length > 0 ? (
        <PhotoViewer
          key={viewer?.version}
          photos={viewerPhotos}
          initialIndex={Math.min(viewerIndex, viewerPhotos.length - 1)}
          total={viewer?.photoIds ? viewerPhotos.length : total}
          coverAvailable={isAlbumEditingAvailable() && coverGuard.available}
          captureCoverContext={coverGuard.capture}
          onClose={closeViewer}
          onEndReached={viewer?.photoIds ? noFilteredPrefetch : loadMore}
          onSetCover={async (photo) => {
            const current = coverGuard.capture();
            if (!current || !current()) throw new DataError('unauthenticated');
            const active = viewerRef.current;
            const fresh = feed.getSnapshot().photos.find(value => value.id === photo.id);
            if (!active || active !== viewer || active.albumId !== id ||
              active.lifetime !== coverGuard.capture || fresh?.isReady !== true ||
              (active.photoIds && !active.photoIds.includes(photo.id))) {
              throw new DataError('server');
            }
            await data.setAlbumCover(id, photo.id);
            if (current() && viewerRef.current === active) void album.refresh();
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
  tools: { padding: Spacing.three, paddingTop: 0, gap: Spacing.two },
  search: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: Radius.control },
  searchInput: { flex: 1, padding: Spacing.three, fontSize: 16, minHeight: 50 },
  clear: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  tile: { overflow: 'hidden' },
  processing: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  processingLabel: { color: '#ffffff', textAlign: 'center', paddingHorizontal: Spacing.one },
  failedProcessing: { backgroundColor: 'rgba(130,22,30,0.82)' },
  processingTrack: { width: '75%', height: 4, marginTop: Spacing.two, backgroundColor: 'rgba(255,255,255,0.35)' },
  processingFill: { height: '100%', backgroundColor: '#ffffff' },
  footer: { paddingVertical: Spacing.four },
});
