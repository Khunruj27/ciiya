import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';

import { PresetPicker } from '@/components/preset-picker';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Segmented } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { PhotoReprocessOptions } from '@/lib/data';
import { useT } from '@/lib/i18n';
import { isPresetPickingAvailable } from '@/lib/preset-release';

type PresetMode = 'keep' | 'choose';

type ReprocessSheetProps = {
  albumId: string;
  count: number;
  onCancel: () => void;
  onConfirm: (options: PhotoReprocessOptions) => void;
};

/**
 * Confirms rendering finished photos again: with each photo's own preset, or
 * with one preset (or none) chosen here for all of them.
 */
export function ReprocessSheet({ albumId, count, onCancel, onConfirm }: ReprocessSheetProps) {
  const t = useT();
  const theme = useTheme();
  const presetsAvailable = isPresetPickingAvailable();
  const [mode, setMode] = useState<PresetMode>('keep');
  const [presetPath, setPresetPath] = useState<string | null>(null);
  const [presetBusy, setPresetBusy] = useState(false);

  function confirm() {
    if (presetBusy) return;
    onConfirm(presetsAvailable && mode === 'choose' ? { presetPath } : {});
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <ScrollView
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.content}
        alwaysBounceVertical={false}>
        <View style={styles.heading}>
          <ThemedText type="subtitle" style={styles.title}>{t.album.reprocessTitle(count)}</ThemedText>
          <ThemedText themeColor="textSecondary">{t.album.reprocessMessage}</ThemedText>
        </View>

        {presetsAvailable ? (
          <Card>
            <ThemedText type="small" themeColor="textSecondary">{t.album.reprocessPresetLabel}</ThemedText>
            <Segmented<PresetMode> value={mode} onChange={setMode} options={[
              { value: 'keep', label: t.album.reprocessPresetKeep },
              { value: 'choose', label: t.album.reprocessPresetChoose },
            ]} />
            <ThemedText type="small" themeColor="textSecondary">
              {mode === 'keep' ? t.album.reprocessPresetKeepHint : t.album.reprocessPresetChooseHint}
            </ThemedText>
          </Card>
        ) : null}

        {presetsAvailable && mode === 'choose' ? (
          <PresetPicker
            albumId={albumId}
            preferredPath={null}
            value={presetPath}
            onChange={setPresetPath}
            disabled={false}
            onBusyChange={setPresetBusy}
          />
        ) : null}

        <Button label={t.album.reprocessConfirm} onPress={confirm} disabled={presetBusy} />
        <Button label={t.common.cancel} onPress={onCancel} variant="secondary" disabled={presetBusy} />
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.four, gap: Spacing.three },
  heading: { gap: Spacing.one, marginBottom: Spacing.two },
  title: { fontSize: 26, lineHeight: 34 },
});
