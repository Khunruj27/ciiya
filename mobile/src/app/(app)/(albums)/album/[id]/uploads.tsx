import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { HeaderButton, StateView } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useAlbumUploads } from '@/hooks/use-uploads';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import { localFile } from '@/lib/uploads/files';
import {
  clearFinishedUploads,
  removeUpload,
  retryFailedUploads,
  retryUpload,
} from '@/lib/uploads/queue';
import type { UploadItem } from '@/lib/uploads/types';

export default function AlbumUploadsScreen() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { items, summary } = useAlbumUploads(id);

  // Anything needing attention first, then what is moving, then what is done.
  const rank = (item: UploadItem) =>
    item.status === 'failed' ? 0 : item.status === 'done' || item.status === 'duplicate' ? 2 : 1;
  const ordered = [...items].sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt);

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () =>
            summary.retryable > 0 ? (
              <HeaderButton
                symbol="arrow.clockwise"
                label={t.uploads.retryAll}
                onPress={() => retryFailedUploads(id)}
              />
            ) : summary.finished > 0 && summary.active === 0 ? (
              <HeaderButton
                symbol="checkmark.circle"
                label={t.uploads.clearFinished}
                onPress={() => clearFinishedUploads(id)}
              />
            ) : null,
        }}
      />

      <FlatList
        data={ordered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        contentInsetAdjustmentBehavior="automatic"
        ListEmptyComponent={<StateView title={t.uploads.empty} />}
        renderItem={({ item }) => <UploadRow item={item} />}
      />
    </>
  );
}

function UploadRow({ item }: { item: UploadItem }) {
  const t = useT();
  const theme = useTheme();

  const finished = item.status === 'done' || item.status === 'duplicate';
  const failed = item.status === 'failed';
  const canRetry = failed && item.failure !== 'file-missing';
  const percent = Math.round(item.progress * 100);

  const statusText = failed
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
  const preview = finished ? null : localFile(item.localName).uri;
  const trailing: SFSymbol = finished ? 'checkmark.circle.fill' : 'xmark';

  const row = (
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
          style={{ color: failed ? theme.danger : theme.textSecondary }}>
          {statusText}
        </ThemedText>
        {item.status === 'uploading' ? (
          <View style={[styles.track, { backgroundColor: theme.backgroundElement }]}>
            <View style={[styles.fill, { backgroundColor: theme.accent, width: `${percent}%` }]} />
          </View>
        ) : null}
      </View>

      {finished ? (
        <SymbolView
          name={trailing}
          size={20}
          tintColor={theme.accentDeep}
          fallback={<ThemedText type="small">✓</ThemedText>}
        />
      ) : (
        <Pressable
          onPress={() => removeUpload(item.id)}
          accessibilityRole="button"
          accessibilityLabel={t.uploads.remove}
          hitSlop={12}
          style={styles.action}>
          <SymbolView
            name={trailing}
            size={16}
            tintColor={theme.textSecondary}
            fallback={<ThemedText type="small">×</ThemedText>}
          />
        </Pressable>
      )}
    </View>
  );

  if (!canRetry) return row;

  return (
    <Pressable
      onPress={() => retryUpload(item.id)}
      accessibilityRole="button"
      accessibilityLabel={`${item.fileName}. ${statusText}`}>
      {row}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.three, gap: Spacing.two, flexGrow: 1 },
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
  action: { minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' },
});
