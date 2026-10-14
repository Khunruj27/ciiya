import { Image } from 'expo-image';
import { Stack, useIsFocused, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AlbumDeliveryPanel } from '@/components/album-delivery-panel';
import { Card, HeaderButton, StateView, formatBytes } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/ctx/session';
import { useAlbumCoverGuard } from '@/hooks/use-album-cover-guard';
import { useAlbumUploads } from '@/hooks/use-uploads';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import { localFile } from '@/lib/uploads/files';
import {
  clearFinishedUploads,
  getUploads,
  removeUpload,
  retryUpload,
} from '@/lib/uploads/queue';
import {
  canRemoveUpload,
  canRetryUpload,
  createUploadReviewActions,
  isUploadFinished,
  isUploadHeld,
  reviewUploads,
  uploadProgress,
} from '@/lib/uploads/review';
import type { UploadItem } from '@/lib/uploads/types';

export default function AlbumUploadsScreen() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useSession();
  if (!user?.id) return <StateView title={t.common.errorSession} />;
  return <OwnedAlbumUploadsScreen key={`${user.id}:${id}`} id={id} accountId={user.id} />;
}

function OwnedAlbumUploadsScreen({ id, accountId }: { id: string; accountId: string }) {
  const t = useT();
  const { items } = useAlbumUploads(id);
  // Reuse the existing read-only lifetime fence: an old dialog cannot mutate
  // a queue after leaving this album or signing out and back into an account.
  const guard = useAlbumCoverGuard(id, useIsFocused());
  const actions = useMemo(() => createUploadReviewActions({
    albumId: id,
    capture: guard.capture,
    getItems: getUploads,
    retry: retryUpload,
    remove: removeUpload,
    clearFinished: clearFinishedUploads,
  }), [id, guard.capture]);
  const review = reviewUploads(items);
  const active = review.queued + review.uploading + review.finishing;

  function handleRemove(uploadId: string) {
    const confirmation = actions.requestRemove(uploadId);
    if (!confirmation) return;
    try {
      Alert.alert(t.uploads.removeTitle, t.uploads.removeMessage(confirmation.fileName), [
        { text: t.common.cancel, style: 'cancel', onPress: confirmation.cancel },
        { text: t.uploads.remove, style: 'destructive', onPress: confirmation.confirm },
      ], { cancelable: true, onDismiss: confirmation.cancel });
    } catch {
      confirmation.cancel();
    }
  }

  // Anything needing attention first, then what is moving, then what is done.
  const rank = (item: UploadItem) =>
    isUploadHeld(item) || item.status === 'failed' ? 0 : isUploadFinished(item) ? 2 : 1;
  const ordered = [...items].sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt);

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () =>
            review.retryable > 0 ? (
              <HeaderButton
                symbol="arrow.clockwise"
                label={t.uploads.retryAll}
                onPress={() => actions.retry()}
                disabled={!guard.available}
              />
            ) : review.stored + review.duplicates > 0 && active === 0 && review.held === 0 ? (
              <HeaderButton
                symbol="checkmark.circle"
                label={t.uploads.clearFinished}
                onPress={actions.clearFinished}
                disabled={!guard.available}
              />
            ) : null,
        }}
      />

      <FlatList
        data={ordered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        contentInsetAdjustmentBehavior="automatic"
        extraData={guard.available}
        ListHeaderComponent={<>
          {items.length > 0 ? <UploadOverview review={review} /> : null}
          <AlbumDeliveryPanel key={`${accountId}:${id}`} albumId={id} accountId={accountId} compact
            uploadComplete={review.stored + review.duplicates > 0 && active === 0 && review.failed === 0 && review.held === 0} />
        </>}
        ListEmptyComponent={<StateView title={t.uploads.empty} />}
        renderItem={({ item }) => (
          <UploadRow item={item} available={guard.available}
            onRetry={() => actions.retry(item.id)} onRemove={() => handleRemove(item.id)} />
        )}
      />
    </>
  );
}

function UploadOverview({ review }: { review: ReturnType<typeof reviewUploads> }) {
  const t = useT();
  const theme = useTheme();
  const keys = ['queued', 'uploading', 'finishing', 'stored', 'duplicates', 'failed'] as const;
  return (
    <Card>
      <ThemedText type="smallBold">{t.uploads.queueOverview}</ThemedText>
      <View style={styles.counts}>
        {keys.map((key) => (
          <View key={key} style={styles.count}>
            <ThemedText type="small" themeColor="textSecondary">{t.uploads.counts[key]}</ThemedText>
            <ThemedText type="smallBold" style={key === 'failed' && review.failed > 0
              ? { color: theme.danger } : undefined}>{review[key]}</ThemedText>
          </View>
        ))}
      </View>
      <ThemedText type="small" themeColor="textSecondary">{t.uploads.foregroundHint}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{t.uploads.storedHint}</ThemedText>
      {review.held > 0 ? (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {t.uploads.heldCount(review.held)}
        </ThemedText>
      ) : null}
    </Card>
  );
}

function UploadRow({ item, available, onRetry, onRemove }: {
  item: UploadItem;
  available: boolean;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const theme = useTheme();

  const finished = isUploadFinished(item);
  const held = isUploadHeld(item);
  const failed = item.status === 'failed';
  const canRetry = canRetryUpload(item);
  const canRemove = canRemoveUpload(item);
  const percent = Math.round(uploadProgress(item.progress) * 100);

  const statusText = held ? t.uploads.held : failed
    ? t.uploads.failure[item.failure ?? 'server']
    : item.status === 'uploading'
      ? t.uploads.status.uploading(percent)
      : item.status === 'finishing'
        ? t.uploads.status.finishing
        : item.status === 'done'
          ? t.uploads.status.done
          : item.status === 'duplicate'
            ? t.uploads.status.duplicate
            : item.failure === 'network'
              ? t.uploads.status.retrying
              : item.attempts > 0
                ? t.uploads.status.retryingServer
                : t.uploads.status.queued;

  // The queued copy is deleted once its upload is stored.
  const preview = finished || held || item.failure === 'file-missing' ? null : localFile(item.localName).uri;

  return (
    <View style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.line }]}>
      <View style={[styles.thumb, { backgroundColor: theme.backgroundElement }]}>
        {preview ? (
          <Image
            source={{ uri: preview }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            recyclingKey={item.id}
          />
        ) : (
          <SymbolView name="photo" size={20} tintColor={theme.textSecondary} />
        )}
      </View>

      <View style={styles.body}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {item.fileName}
        </ThemedText>
        <ThemedText
          type="small"
          numberOfLines={2}
          style={{ color: failed || held ? theme.danger : theme.textSecondary }}>
          {statusText}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{formatBytes(item.sizeBytes)}</ThemedText>
        {!held && !finished && item.registering ? (
          <ThemedText type="small" themeColor="textSecondary">{t.uploads.registrationRetained}</ThemedText>
        ) : null}
        {!held && item.status === 'uploading' ? (
          <View style={[styles.track, { backgroundColor: theme.backgroundElement }]}
            accessibilityRole="progressbar" accessibilityLabel={statusText}
            accessibilityValue={{ min: 0, max: 100, now: percent }}>
            <View style={[styles.fill, { backgroundColor: theme.accent, width: `${percent}%` }]} />
          </View>
        ) : null}
        {canRetry ? (
          <Pressable onPress={onRetry} disabled={!available}
            accessibilityRole="button" accessibilityState={{ disabled: !available }}
            accessibilityLabel={t.uploads.retryOne(item.fileName)} style={styles.retry}>
            <ThemedText type="smallBold" style={{ color: theme.accentDeep }}>{t.common.retry}</ThemedText>
          </Pressable>
        ) : null}
      </View>

      {finished && !held ? (
        <SymbolView
          name="checkmark.circle.fill"
          size={20}
          tintColor={theme.accentDeep}
          fallback={<ThemedText type="small">✓</ThemedText>}
        />
      ) : canRemove ? (
        <Pressable
          onPress={onRemove}
          disabled={!available}
          accessibilityRole="button"
          accessibilityState={{ disabled: !available }}
          accessibilityLabel={t.uploads.removeOne(item.fileName)}
          style={styles.action}>
          <SymbolView
            name="xmark"
            size={16}
            tintColor={theme.textSecondary}
            fallback={<ThemedText type="small">×</ThemedText>}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.three, gap: Spacing.two, flexGrow: 1 },
  counts: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  count: { width: '45%', gap: Spacing.half },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.two,
    paddingRight: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.control,
  },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: Radius.control - 4,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: Spacing.half },
  track: { height: 4, borderRadius: Radius.pill, overflow: 'hidden', marginTop: Spacing.one },
  fill: { height: 4, borderRadius: Radius.pill },
  retry: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  action: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
