import type { ImagePickerAsset } from 'expo-image-picker';
import { useRef, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, View } from 'react-native';

import { PresetPicker } from '@/components/preset-picker';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Segmented } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Album } from '@/lib/data';
import { useT } from '@/lib/i18n';
import { isPresetPickingAvailable } from '@/lib/preset-release';
import {
  getPreferredPreset,
  getPreferredUploadSize,
  setPreferredPreset,
  setPreferredUploadSize,
} from '@/lib/uploads/prefs';
import { enqueueUploads } from '@/lib/uploads/queue';
import type { UploadSize } from '@/lib/uploads/types';

type UploadSheetProps = {
  album: Album;
  /** The photos just picked from the library. */
  assets: ImagePickerAsset[];
  onClose: () => void;
};

/** Confirms a batch picked from the library and sets its delivery size. */
export function UploadSheet({ album, assets, onClose }: UploadSheetProps) {
  const t = useT();
  const theme = useTheme();
  const [size, setSize] = useState<UploadSize>(getPreferredUploadSize);
  const [prepared, setPrepared] = useState<number | null>(null);
  const presetsAvailable = isPresetPickingAvailable();
  const [presetPath, setPresetPath] = useState<string | null>(null);
  const [preferredPreset] = useState(() => getPreferredPreset(album.id));
  const [presetBusy, setPresetBusy] = useState(false);
  const busy = prepared !== null;
  const preparingRef = useRef(false);

  const sizeOptions: { value: UploadSize; label: string }[] = [
    { value: 'sd', label: t.settings.sizes.sd },
    { value: 'hd', label: t.settings.sizes.hd },
    { value: 'uhd', label: t.settings.sizes.uhd },
    { value: 'original', label: t.settings.sizes.original },
  ];

  function handleCancel() {
    if (preparingRef.current) return;

    // A picker URI can point to the user's original. Only the queue may remove
    // copies it created under its own private documents directory.
    onClose();
  }

  async function handleUpload() {
    if (preparingRef.current || presetBusy) return;

    preparingRef.current = true;
    setPrepared(0);
    setPreferredUploadSize(size);
    const chosenPreset = presetsAvailable ? presetPath : null;
    if (presetsAvailable) setPreferredPreset(album.id, chosenPreset);

    try {
      const result = await enqueueUploads(
        album.id,
        assets,
        { size, presetPath: chosenPreset, autoFaceScan: album.autoFaceScan, autoPublish: album.autoPublish },
        (done) => setPrepared(done)
      );

      const notes = [
        result.unreadable > 0 ? t.uploads.skippedUnreadable(result.unreadable) : null,
        result.alreadyQueued > 0 ? t.uploads.skippedQueued(result.alreadyQueued) : null,
      ].filter((note): note is string => Boolean(note));

      if (notes.length === 0) {
        onClose();
        return;
      }

      // Shown over the sheet, which closes once the note has been read.
      Alert.alert(t.uploads.skippedTitle, notes.join('\n'), [
        { text: t.common.ok, onPress: onClose },
      ]);
    } catch {
      preparingRef.current = false;
      setPrepared(null);
      Alert.alert(t.common.errorGeneric);
    }
  }

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleCancel}>
      <ScrollView
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.content}
        alwaysBounceVertical={false}>
        <View style={styles.heading}>
          <ThemedText type="subtitle" style={styles.title}>
            {t.uploads.sheetTitle(assets.length)}
          </ThemedText>
          <ThemedText themeColor="textSecondary">{t.uploads.sheetHint}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{t.uploads.foregroundHint}</ThemedText>
        </View>

        {/* The size is fixed once the batch starts being queued. */}
        <View pointerEvents={busy ? 'none' : 'auto'}>
          <Card>
            <ThemedText type="small" themeColor="textSecondary">
              {t.uploads.sizeLabel}
            </ThemedText>
            <Segmented options={sizeOptions} value={size} onChange={setSize} />
            <ThemedText type="small" themeColor="textSecondary">
              {t.uploads.sizeHints[size]}
            </ThemedText>
          </Card>
        </View>

        {presetsAvailable ? (
          <PresetPicker
            albumId={album.id}
            preferredPath={preferredPreset}
            value={presetPath}
            onChange={setPresetPath}
            disabled={busy}
            onBusyChange={setPresetBusy}
          />
        ) : null}

        <Button
          label={busy ? t.uploads.preparing(prepared, assets.length) : t.uploads.start}
          onPress={handleUpload}
          loading={busy}
          disabled={presetBusy}
        />
        <Button
          label={t.common.cancel}
          onPress={handleCancel}
          variant="secondary"
          disabled={busy || presetBusy}
        />
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.four, gap: Spacing.three },
  heading: { gap: Spacing.one, marginBottom: Spacing.two },
  title: { fontSize: 26, lineHeight: 34 },
});
