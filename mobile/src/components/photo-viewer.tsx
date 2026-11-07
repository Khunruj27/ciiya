import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
  type NativeGesture,
} from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { Radius, Spacing } from '@/constants/theme';
import type { Photo } from '@/lib/data';
import { useT } from '@/lib/i18n';
import {
  adjacentPhotoIndex,
  clampPhotoOffset,
  clampZoom,
  containSize,
  photoIndexFromOffset,
  pinchPhotoOffset,
} from '@/lib/photo-zoom';

type PhotoViewerProps = {
  photos: Photo[];
  initialIndex: number;
  /** Total photos in the album, which can exceed the pages loaded so far. */
  total: number;
  onClose: () => void;
  onEndReached: () => void;
  /** Resolves when the cover was saved; rejects to show the failure state. */
  onSetCover: (photo: Photo) => Promise<void>;
  /** Fail closed until the separate native album-edit server release is approved. */
  coverAvailable?: boolean;
  /** Capture the current account/focus generation before an intentional write. */
  captureCoverContext?: () => (() => boolean) | null;
  /**
   * Deletes the photo after the owner confirmed. Resolves once the server
   * settled it (the parent removes it from the list); rejects on failure.
   * Omitted while deletion is not available.
   */
  onDeletePhoto?: (photo: Photo) => Promise<void>;
};

const ACTIVE_PROCESSING = new Set(['pending', 'processing', 'uploading', 'finalizing']);

// Tied to a photo id so a save that finishes after the photographer has swiped
// on never shows its result against a different photo.
type CoverState = { photoId: string; status: 'saving' | 'done' | 'failed' } | null;

/**
 * Full-screen photo pager: swipe between photos, pinch to zoom. The viewer is
 * always dark, like a lightbox, regardless of the app's colour scheme.
 */
export function PhotoViewer({
  photos,
  initialIndex,
  total,
  onClose,
  onEndReached,
  onSetCover,
  coverAvailable = false,
  captureCoverContext = () => () => true,
  onDeletePhoto,
}: PhotoViewerProps) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [selection, setSelection] = useState({ index: initialIndex, version: 0 });
  const { index, version } = selection;
  const [coverState, setCoverState] = useState<CoverState>(null);
  const coverAction = useRef<CoverState>(null);
  const viewerActive = useRef(true);
  useLayoutEffect(() => {
    viewerActive.current = true;
    return () => { viewerActive.current = false; };
  }, []);
  const [zoomOwner, setZoomOwner] = useState<string | null>(null);
  const pager = useRef<FlatList<Photo>>(null);
  const pagerGesture = useMemo(() => Gesture.Native(), []);
  const current = photos[index];
  const zoomKey = `${current?.id}:${width}:${height}`;
  const activePage = useRef({ key: zoomKey, index, version, width, height, photos, coverAvailable });
  useLayoutEffect(() => {
    activePage.current = { key: zoomKey, index, version, width, height, photos, coverAvailable };
  }, [coverAvailable, height, index, photos, version, width, zoomKey]);
  const isCurrentActivation = useCallback((key: string, sourceVersion: number) => (
    key === activePage.current.key && sourceVersion === activePage.current.version
  ), []);
  const prefetchedCount = useRef(-1);
  useEffect(() => {
    // Button navigation and opening a photo near the loaded edge must also
    // prefetch, without relying on a native drag to reach onEndReached.
    if (
      photos.length > 0 && photos.length < total && index >= photos.length - 3 &&
      prefetchedCount.current !== photos.length
    ) {
      prefetchedCount.current = photos.length;
      onEndReached();
    }
  }, [index, onEndReached, photos.length, total]);
  const gotoPhoto = useCallback((sourceKey: string, direction: -1 | 1) => {
    const page = activePage.current;
    if (
      sourceKey !== page.key || version !== page.version || !pager.current ||
      !Number.isFinite(page.width) || page.width <= 0
    ) return;
    const next = adjacentPhotoIndex(page.index, direction, page.photos.length);
    if (next === null) return;
    pager.current.scrollToOffset({ offset: next * page.width, animated: false });
    // Update the guard immediately: repeated presses or a queued zoom callback
    // from the previous photo cannot act on the new page before React commits.
    activePage.current = {
      ...page, key: `${page.photos[next].id}:${page.width}:${page.height}`, index: next,
      version: page.version + 1,
    };
    setZoomOwner(null);
    setSelection({ index: next, version: page.version + 1 });
  }, [version]);
  const onZoomStateChange = useCallback((key: string, locked: boolean) => {
    // A queued callback must not relock a later visit to the same photo, even
    // when an away/back swipe was batched before the child could deactivate.
    if (!isCurrentActivation(key, version)) return;
    setZoomOwner(locked ? key : null);
    if (locked) {
      // Native paging may have moved a few pixels before a two-finger pinch
      // activated. Recenter its page without moving the zoomed image itself.
      pager.current?.scrollToOffset({
        offset: activePage.current.index * activePage.current.width,
        animated: false,
      });
    }
  }, [isCurrentActivation, version]);
  const coverStatus = current && coverState?.photoId === current.id ? coverState.status : 'idle';
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Synchronous fence: one deletion at a time, even before the button re-renders.
  const deletingRef = useRef(false);
  const currentProcessing = ACTIVE_PROCESSING.has(String(current?.processingStatus ?? ''));

  function confirmDelete() {
    const page = activePage.current;
    const photo = page.photos[page.index];
    if (!onDeletePhoto || !viewerActive.current || deletingRef.current || !photo || page.key !== zoomKey) return;
    if (ACTIVE_PROCESSING.has(String(photo.processingStatus ?? ''))) {
      Alert.alert(t.viewer.deleteProcessing);
      return;
    }
    const contextCurrent = captureCoverContext();
    if (!contextCurrent || !contextCurrent()) return;

    Alert.alert(t.viewer.deleteTitle, t.viewer.deleteMessage(photo.filename || t.viewer.deletePhoto), [
      { text: t.common.cancel, style: 'cancel' },
      {
        text: t.viewer.deleteConfirm,
        style: 'destructive',
        onPress: () => { void runDelete(photo, contextCurrent); },
      },
    ]);
  }

  async function runDelete(photo: Photo, contextCurrent: () => boolean) {
    // The dialog may outlive this visit: re-check before anything is sent.
    if (!onDeletePhoto || !viewerActive.current || deletingRef.current || !contextCurrent()) return;
    deletingRef.current = true;
    setDeletingId(photo.id);
    try {
      await onDeletePhoto(photo);
    } catch {
      if (viewerActive.current && contextCurrent()) Alert.alert(t.viewer.deleteFailed);
    } finally {
      deletingRef.current = false;
      if (viewerActive.current) setDeletingId(null);
    }
  }

  async function handleSetCover() {
    const page = activePage.current;
    const photo = page.photos[page.index];
    const action = coverAction.current;
    // Paging updates this key before React commits. Never let a queued button
    // from the previously visible photo save its stale captured photo.
    if (
      !viewerActive.current || !coverAvailable || !page.coverAvailable ||
      page.key !== zoomKey || page.version !== version || !photo?.isReady || action?.status === 'saving' ||
      (action?.photoId === photo.id && action.status === 'done')
    ) return;
    const contextCurrent = captureCoverContext();
    if (!contextCurrent || !contextCurrent()) return;
    const saving: CoverState = { photoId: photo.id, status: 'saving' };
    // The synchronous fence blocks repeated presses even before the disabled
    // button renders, including a resolved request whose UI hasn't committed.
    coverAction.current = saving;
    setCoverState(saving);
    let status: 'done' | 'failed';
    try {
      await onSetCover(photo);
      status = 'done';
    } catch {
      status = 'failed';
    }
    if (!viewerActive.current || coverAction.current !== saving) return;
    if (!contextCurrent()) {
      // An acknowledgement from an earlier account/focus generation must not
      // paint a result in the returned viewer or retain its loading indicator.
      coverAction.current = null;
      setCoverState(null);
      return;
    }
    const finished: CoverState = { photoId: photo.id, status };
    coverAction.current = finished;
    setCoverState(finished);
  }

  const coverLabel =
    !coverAvailable
      ? t.viewer.coverUnavailable
      : coverStatus === 'saving'
      ? t.viewer.settingCover
      : coverStatus === 'done'
        ? t.viewer.coverSet
        : coverStatus === 'failed'
          ? t.viewer.coverFailed
          : t.viewer.setCover;

  function closeViewer() {
    // Fence queued presses/completions synchronously, before the parent renders.
    viewerActive.current = false;
    onClose();
  }

  return (
    <Modal
      visible
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={closeViewer}
      statusBarTranslucent>
      <StatusBar style="light" />
      {/* Android Modals are a separate native root, even when the app has one. */}
      <GestureHandlerRootView style={styles.backdrop} onLayout={() => setZoomOwner(null)}>
        <GestureDetector gesture={pagerGesture}>
          <FlatList
            ref={pager}
            key={`${width}:${height}`}
            data={photos}
            horizontal
            pagingEnabled
            scrollEnabled={zoomOwner !== zoomKey}
            keyExtractor={(photo) => photo.id}
            initialScrollIndex={index}
            getItemLayout={(_, itemIndex) => ({
              length: width,
              offset: width * itemIndex,
              index: itemIndex,
            })}
            showsHorizontalScrollIndicator={false}
            initialNumToRender={1}
            maxToRenderPerBatch={2}
            windowSize={3}
            onEndReached={onEndReached}
            onEndReachedThreshold={2}
            scrollEventThrottle={32}
            onScroll={(event) => {
              const page = activePage.current;
              // Ignore events still queued by a pager replaced on rotation.
              if (page.width !== width || page.height !== height) return;
              // Follow the page under the finger, not just where a swipe settles,
              // so the counter and actions always refer to the visible photo.
              const next = photoIndexFromOffset(event.nativeEvent.contentOffset.x, width, page.photos.length);
              if (next !== null && next !== page.index) {
                activePage.current = {
                  ...page, key: `${page.photos[next].id}:${page.width}:${page.height}`, index: next,
                  version: page.version + 1,
                };
                setZoomOwner(null);
                setSelection({ index: next, version: page.version + 1 });
              }
            }}
            renderItem={({ item }) => (
              <ZoomablePhoto
                // Keep the image mounted while selection changes mid-swipe.
                key={`${item.id}:${width}:${height}`}
                photo={item}
                width={width}
                height={height}
                active={item.id === current?.id}
                activationVersion={item.id === current?.id ? version : -1}
                pagerGesture={pagerGesture}
                isCurrentActivation={isCurrentActivation}
                onZoomStateChange={onZoomStateChange}
              />
            )}
          />
        </GestureDetector>

        <View style={[styles.topBar, { paddingTop: insets.top + Spacing.two }]}>
          <Pressable
            onPress={closeViewer}
            accessibilityRole="button"
            accessibilityLabel={t.common.close}
            hitSlop={12}
            style={styles.roundButton}>
            <SymbolView
              name="xmark"
              size={18}
              tintColor="#ffffff"
              fallback={<Text style={styles.overlayText}>×</Text>}
            />
          </Pressable>
          <View style={styles.pageControls}>
            <Pressable
              onPress={() => gotoPhoto(zoomKey, -1)}
              disabled={adjacentPhotoIndex(index, -1, photos.length) === null}
              accessibilityRole="button"
              accessibilityLabel={t.viewer.previousPhoto}
              accessibilityState={{ disabled: adjacentPhotoIndex(index, -1, photos.length) === null }}
              hitSlop={12}
              style={[styles.roundButton, index <= 0 && styles.disabled]}>
              <SymbolView
                name="chevron.left"
                size={18}
                tintColor="#ffffff"
                fallback={<Text style={styles.overlayText}>‹</Text>}
              />
            </Pressable>
            <Text style={styles.overlayText}>{t.viewer.counter(index + 1, total)}</Text>
            <Pressable
              onPress={() => gotoPhoto(zoomKey, 1)}
              disabled={adjacentPhotoIndex(index, 1, photos.length) === null}
              accessibilityRole="button"
              accessibilityLabel={t.viewer.nextPhoto}
              accessibilityState={{ disabled: adjacentPhotoIndex(index, 1, photos.length) === null }}
              hitSlop={12}
              style={[styles.roundButton, index >= photos.length - 1 && styles.disabled]}>
              <SymbolView
                name="chevron.right"
                size={18}
                tintColor="#ffffff"
                fallback={<Text style={styles.overlayText}>›</Text>}
              />
            </Pressable>
          </View>
          {onDeletePhoto ? (
            <Pressable
              onPress={confirmDelete}
              disabled={deletingId !== null || currentProcessing}
              accessibilityRole="button"
              accessibilityLabel={deletingId ? t.viewer.deleting : t.viewer.deletePhoto}
              accessibilityState={{ disabled: deletingId !== null || currentProcessing, busy: deletingId !== null }}
              hitSlop={12}
              style={[styles.roundButton, (deletingId !== null || currentProcessing) && styles.disabled]}>
              {deletingId ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <SymbolView
                  name="trash"
                  size={18}
                  tintColor="#ffffff"
                  fallback={<Text style={styles.overlayText}>⌫</Text>}
                />
              )}
            </Pressable>
          ) : (
            <View style={styles.roundButtonSpacer} />
          )}
        </View>

        {current?.isReady ? (
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + Spacing.three }]}>
            <Pressable
              onPress={handleSetCover}
              disabled={!coverAvailable || coverState?.status === 'saving' || coverStatus === 'done'}
              accessibilityRole="button"
              accessibilityLabel={coverLabel}
              accessibilityState={{ disabled: !coverAvailable || coverState?.status === 'saving' || coverStatus === 'done' }}
              style={({ pressed }) => [styles.pill, !coverAvailable && styles.disabled, pressed && styles.pressed]}>
              {coverStatus === 'saving' ? <ActivityIndicator color="#ffffff" /> : null}
              <Text style={styles.pillLabel}>{coverLabel}</Text>
            </Pressable>
          </View>
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}

type ZoomablePhotoProps = {
  photo: Photo;
  width: number;
  height: number;
  active: boolean;
  activationVersion: number;
  pagerGesture: NativeGesture;
  isCurrentActivation: (key: string, version: number) => boolean;
  onZoomStateChange: (key: string, locked: boolean) => void;
};

/** Keep image zoom independent of the outer pager on both OSes, without a
 * competing nested native scroll viewport. */
function ZoomablePhoto({
  photo, width, height, active, activationVersion, pagerGesture, isCurrentActivation, onZoomStateChange,
}: ZoomablePhotoProps) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const uri = photo.previewUrl || photo.thumbnailUrl;
  const placeholder = photo.thumbnailUrl || photo.blurDataUrl;
  const fitted = containSize(photo.width, photo.height, width, height);
  const scale = useSharedValue(1);
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const pinchStartScale = useSharedValue(1);
  const pinchStartX = useSharedValue(0);
  const pinchStartY = useSharedValue(0);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  const pinching = useSharedValue(false);
  const gestureActivation = useSharedValue(-1);
  const mounted = useRef(true);
  const activation = useRef({ active, version: activationVersion });
  const [displayScale, setDisplayScale] = useState(1);

  useLayoutEffect(() => {
    const changed = activation.current.version !== activationVersion;
    activation.current = { active, version: activationVersion };
    gestureActivation.set(active ? activationVersion : -1);
    // Reset zoom without destroying the Image view. Also reset on a new visit
    // if React batched an away/back swipe and never rendered the inactive page.
    if (changed || !active) {
      scale.set(1);
      offsetX.set(0);
      offsetY.set(0);
      pinchStartScale.set(1);
      pinchStartX.set(0);
      pinchStartY.set(0);
      focalX.set(0);
      focalY.set(0);
      pinching.set(false);
      setDisplayScale(1);
    }
  }, [
    active, activationVersion, focalX, focalY, gestureActivation, offsetX, offsetY,
    pinchStartScale, pinchStartX, pinchStartY, pinching, scale,
  ]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      activation.current.active = false;
      gestureActivation.set(-1);
    };
  }, [gestureActivation]);
  const reportZoom = useCallback((nextScale: number, touching = false) => {
    if (
      !mounted.current || !activation.current.active ||
      activation.current.version !== activationVersion ||
      !isCurrentActivation(`${photo.id}:${width}:${height}`, activationVersion)
    ) return;
    setDisplayScale(nextScale);
    onZoomStateChange(`${photo.id}:${width}:${height}`, touching || nextScale > 1);
  }, [activationVersion, height, isCurrentActivation, onZoomStateChange, photo.id, width]);

  const gesture = useMemo(() => {
    const pinch = Gesture.Pinch()
      .enabled(active && !!uri)
      // Never make one-finger native paging wait for a pinch to fail. Once a
      // pinch actually starts, the RN callback locks/recenters the parent page.
      .simultaneousWithExternalGesture(pagerGesture)
      // This registers a native callback; it never reads the mounted ref during render.
      // eslint-disable-next-line react-hooks/refs
      .onStart((event) => {
        if (activationVersion < 0 || gestureActivation.get() !== activationVersion) return;
        pinching.set(true);
        pinchStartScale.set(scale.get());
        pinchStartX.set(offsetX.get());
        pinchStartY.set(offsetY.get());
        focalX.set(event.focalX);
        focalY.set(event.focalY);
        scheduleOnRN(reportZoom, scale.get(), true);
      })
      .onUpdate((event) => {
        if (activationVersion < 0 || gestureActivation.get() !== activationVersion || !pinching.get()) return;
        // After one finger lifts, don't jump to the remaining finger's focal.
        if (event.numberOfPointers < 2) return;
        const next = clampZoom(pinchStartScale.get() * event.scale);
        scale.set(next);
        offsetX.set(clampPhotoOffset(
          pinchPhotoOffset(pinchStartX.get(), pinchStartScale.get(), next, focalX.get(), event.focalX, width),
          fitted.width * next,
          width
        ));
        offsetY.set(clampPhotoOffset(
          pinchPhotoOffset(pinchStartY.get(), pinchStartScale.get(), next, focalY.get(), event.focalY, height),
          fitted.height * next,
          height
        ));
      })
      // This native callback schedules reportZoom after recognition, not during render.
      // eslint-disable-next-line react-hooks/refs
      .onFinalize(() => {
        if (activationVersion < 0 || gestureActivation.get() !== activationVersion) return;
        pinching.set(false);
        scheduleOnRN(reportZoom, scale.get());
      });

    const pan = Gesture.Pan()
      // Only the zoomed image owns single-finger pan. At 1x the finger is
      // available to the outer native pager, without manual activation/fail.
      .enabled(active && !!uri && displayScale > 1)
      .minDistance(1)
      .maxPointers(1)
      .averageTouches(true)
      .simultaneousWithExternalGesture(pagerGesture)
      .onChange((event) => {
        if (activationVersion < 0 || gestureActivation.get() !== activationVersion || pinching.get()) return;
        offsetX.set(clampPhotoOffset(offsetX.get() + event.changeX, fitted.width * scale.get(), width));
        offsetY.set(clampPhotoOffset(offsetY.get() + event.changeY, fitted.height * scale.get(), height));
      });
    return Gesture.Simultaneous(pinch, pan);
  }, [
    active, activationVersion, displayScale, fitted.height, fitted.width, focalX, focalY,
    gestureActivation, height, offsetX, offsetY, pagerGesture,
    pinchStartScale, pinchStartX, pinchStartY, pinching, reportZoom, scale, uri, width,
  ]);

  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offsetX.get() }, { translateY: offsetY.get() }, { scale: scale.get() }],
  }));

  function changeZoom(next: number) {
    if (
      !mounted.current || !activation.current.active ||
      activation.current.version !== activationVersion ||
      !isCurrentActivation(`${photo.id}:${width}:${height}`, activationVersion)
    ) return;
    const bounded = clampZoom(next);
    scale.set(bounded);
    offsetX.set(clampPhotoOffset(offsetX.get(), fitted.width * bounded, width));
    offsetY.set(clampPhotoOffset(offsetY.get(), fitted.height * bounded, height));
    reportZoom(bounded);
  }

  return (
    <View style={[styles.zoomViewport, { width, height }]}>
      <GestureDetector gesture={gesture}>
        <View
          style={{ width, height }}
          collapsable={false}>
          {/* Attach gestures to an untransformed viewport: focal coordinates
              must not move with the image being scaled underneath them. */}
          <Animated.View style={[{ width, height }, imageStyle]}>
            {uri ? (
              <Image
                source={{ uri }}
                placeholder={placeholder ? { uri: placeholder } : undefined}
                placeholderContentFit="contain"
                style={{ width, height }}
                contentFit="contain"
                transition={0}
                accessibilityLabel={photo.filename ?? undefined}
              />
            ) : null}
          </Animated.View>
        </View>
      </GestureDetector>
      {active && uri ? (
        <View style={[styles.zoomControls, { bottom: insets.bottom + 80 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.viewer.zoomOut}
            accessibilityState={{ disabled: displayScale === 1 }}
            disabled={displayScale === 1}
            onPress={() => changeZoom(scale.get() - 1)}
            style={styles.zoomButton}>
            <Text style={styles.overlayText}>−</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.viewer.resetZoom}
            onPress={() => changeZoom(1)}
            style={styles.zoomButton}>
            <Text style={styles.overlayText}>1×</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.viewer.zoomIn}
            accessibilityState={{ disabled: displayScale === 4 }}
            disabled={displayScale === 4}
            onPress={() => changeZoom(scale.get() + 1)}
            style={styles.zoomButton}>
            <Text style={styles.overlayText}>+</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000000' },
  zoomViewport: { overflow: 'hidden' },
  zoomControls: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: Spacing.two,
  },
  zoomButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
  },
  roundButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  roundButtonSpacer: { width: 40 },
  pageControls: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  disabled: { opacity: 0.35 },
  overlayText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  pill: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  pillLabel: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
