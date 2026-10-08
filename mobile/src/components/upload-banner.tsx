import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import type { UploadSummary } from '@/hooks/use-uploads';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';

type UploadBannerProps = {
  summary: UploadSummary;
  /** Opens the full list of this album's uploads. */
  onOpen: () => void;
  onRetry: () => void;
  onDismiss: () => void;
};

/** One-line state of an album's upload batch, shown above its photo grid. */
export function UploadBanner({ summary, onOpen, onRetry, onDismiss }: UploadBannerProps) {
  const t = useT();
  const theme = useTheme();

  if (summary.total === 0) return null;

  const uploading = summary.active > 0;
  const failed = !uploading && summary.failed > 0;
  const batch = summary.finished + summary.active;

  const message = uploading
    ? summary.waitingForNetwork
      ? t.uploads.bannerWaiting
      : t.uploads.bannerUploading(Math.min(summary.finished + 1, batch), batch)
    : failed
      ? t.uploads.bannerFailed(summary.failed)
      : summary.duplicates === 0
        ? t.uploads.bannerDone(summary.finished)
        : summary.duplicates === summary.finished
          ? t.uploads.bannerAllDuplicates(summary.duplicates)
          : t.uploads.bannerDoneWithDuplicates(
              summary.finished - summary.duplicates,
              summary.duplicates
            );

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={message}
      accessibilityHint={t.uploads.details}
      style={({ pressed }) => [
        styles.banner,
        { backgroundColor: theme.surface, borderColor: failed ? theme.danger : theme.line },
        pressed && styles.pressed,
      ]}>
      <View style={styles.row}>
        <ThemedText
          type="smallBold"
          style={[styles.message, failed && { color: theme.danger }]}
          numberOfLines={2}>
          {message}
        </ThemedText>

        {failed ? (
          summary.retryable > 0 ? (
            <Pressable onPress={onRetry} accessibilityRole="button" hitSlop={10}>
              <ThemedText type="smallBold" style={{ color: theme.accentDeep }}>
                {t.common.retry}
              </ThemedText>
            </Pressable>
          ) : (
            <ThemedText type="smallBold" style={{ color: theme.accentDeep }}>
              {t.uploads.details}
            </ThemedText>
          )
        ) : uploading ? (
          <ThemedText type="small" themeColor="textSecondary">
            {Math.round(summary.progress * 100)}%
          </ThemedText>
        ) : (
          <Pressable
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel={t.common.close}
            hitSlop={12}>
            <SymbolView
              name="xmark"
              size={14}
              tintColor={theme.textSecondary}
              fallback={<ThemedText type="small">×</ThemedText>}
            />
          </Pressable>
        )}
      </View>

      {uploading ? (
        <View
          style={[styles.track, { backgroundColor: theme.backgroundElement }]}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(summary.progress * 100) }}>
          <View
            style={[
              styles.fill,
              { backgroundColor: theme.accent, width: `${Math.round(summary.progress * 100)}%` },
            ]}
          />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.three,
    padding: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.control,
    gap: Spacing.two,
  },
  pressed: { opacity: 0.8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  message: { flex: 1 },
  track: { height: 6, borderRadius: Radius.pill, overflow: 'hidden' },
  fill: { height: 6, borderRadius: Radius.pill },
});
