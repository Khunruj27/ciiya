import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Radius, Spacing } from '@/constants/theme';
import type { Photo } from '@/lib/data';
import { useT } from '@/lib/i18n';

type PhotoViewerProps = {
  photos: Photo[];
  initialIndex: number;
  /** Total photos in the album, which can exceed the pages loaded so far. */
  total: number;
  onClose: () => void;
  onEndReached: () => void;
  /** Resolves when the cover was saved; rejects to show the failure state. */
  onSetCover: (photo: Photo) => Promise<void>;
};

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
}: PhotoViewerProps) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(initialIndex);
  const [coverState, setCoverState] = useState<CoverState>(null);

  const current = photos[index];
  const coverStatus = current && coverState?.photoId === current.id ? coverState.status : 'idle';

  async function handleSetCover() {
    if (!current || coverState?.status === 'saving') return;

    const photo = current;
    setCoverState({ photoId: photo.id, status: 'saving' });
    try {
      await onSetCover(photo);
      setCoverState({ photoId: photo.id, status: 'done' });
    } catch {
      setCoverState({ photoId: photo.id, status: 'failed' });
    }
  }

  const coverLabel =
    coverStatus === 'saving'
      ? t.viewer.settingCover
      : coverStatus === 'done'
        ? t.viewer.coverSet
        : coverStatus === 'failed'
          ? t.viewer.coverFailed
          : t.viewer.setCover;

  return (
    <Modal
      visible
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
      statusBarTranslucent>
      <StatusBar style="light" />
      <View style={styles.backdrop}>
        <FlatList
          data={photos}
          horizontal
          pagingEnabled
          keyExtractor={(photo) => photo.id}
          initialScrollIndex={initialIndex}
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
            // Follow the page under the finger, not just where a swipe settles,
            // so the counter and actions always refer to the visible photo.
            const next = Math.min(
              Math.max(Math.round(event.nativeEvent.contentOffset.x / width), 0),
              photos.length - 1
            );
            if (next !== index) setIndex(next);
          }}
          renderItem={({ item }) => <ZoomablePhoto photo={item} width={width} height={height} />}
        />

        <View style={[styles.topBar, { paddingTop: insets.top + Spacing.two }]}>
          <Pressable
            onPress={onClose}
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
          <Text style={styles.overlayText}>{t.viewer.counter(index + 1, total)}</Text>
          <View style={styles.roundButtonSpacer} />
        </View>

        {current?.isReady ? (
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + Spacing.three }]}>
            <Pressable
              onPress={handleSetCover}
              disabled={coverState?.status === 'saving' || coverStatus === 'done'}
              accessibilityRole="button"
              style={({ pressed }) => [styles.pill, pressed && styles.pressed]}>
              {coverStatus === 'saving' ? <ActivityIndicator color="#ffffff" /> : null}
              <Text style={styles.pillLabel}>{coverLabel}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function ZoomablePhoto({ photo, width, height }: { photo: Photo; width: number; height: number }) {
  const uri = photo.previewUrl || photo.thumbnailUrl;
  // Show the small thumbnail (or blur) instantly while the large file loads.
  const placeholder = photo.thumbnailUrl || photo.blurDataUrl;

  return (
    <ScrollView
      style={{ width, height }}
      contentContainerStyle={{ width, height }}
      maximumZoomScale={4}
      minimumZoomScale={1}
      centerContent
      bouncesZoom
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}>
      {uri ? (
        <Image
          source={{ uri }}
          placeholder={placeholder ? { uri: placeholder } : undefined}
          placeholderContentFit="contain"
          style={{ width, height }}
          contentFit="contain"
          transition={120}
          accessibilityLabel={photo.filename ?? undefined}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000000' },
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
