import { File } from 'expo-file-system';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { data, type AlbumPreset } from '@/lib/data';
import { useT } from '@/lib/i18n';

/** Mirrors the server's limit, so an oversized file is refused before sending. */
const MAX_PRESET_BYTES = 2 * 1024 * 1024;

type PresetPickerProps = {
  albumId: string;
  /** The preset to preselect when it is still offered. */
  preferredPath: string | null;
  value: string | null;
  onChange: (path: string | null) => void;
  /** Locks the choice once the batch starts being queued. */
  disabled: boolean;
  /** Reports an in-flight preset upload so the batch waits for it. */
  onBusyChange: (busy: boolean) => void;
};

type ListState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; presets: AlbumPreset[] };

/** Choose one of the album's Lightroom presets, or add a new .xmp from Files. */
export function PresetPicker({
  albumId,
  preferredPath,
  value,
  onChange,
  disabled,
  onBusyChange,
}: PresetPickerProps) {
  const t = useT();
  const theme = useTheme();
  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [adding, setAdding] = useState(false);
  const addingRef = useRef(false);
  const mounted = useRef(true);
  const loadSequence = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function fetchPresets() {
    const request = ++loadSequence.current;
    data.fetchAlbumPresets(albumId).then(
      (presets) => {
        if (!mounted.current || request !== loadSequence.current) return;
        setList({ status: 'ready', presets });
        // Preselect the last-used preset only if this album still offers it.
        if (preferredPath && presets.some((preset) => preset.path === preferredPath)) onChange(preferredPath);
      },
      () => {
        if (mounted.current && request === loadSequence.current) setList({ status: 'error' });
      }
    );
  }

  function reload() {
    setList({ status: 'loading' });
    fetchPresets();
  }

  useEffect(() => {
    fetchPresets();
    // Load once per album; the parent mounts a new picker for each sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albumId]);

  async function addPreset() {
    if (addingRef.current || disabled) return;
    addingRef.current = true;
    setAdding(true);
    onBusyChange(true);

    try {
      const picked = await File.pickFileAsync({ mimeTypes: '*/*' });
      if (picked.canceled || !picked.result) return;
      const file = picked.result;
      const fileName = file.name || 'preset.xmp';
      const size = Number(file.size) || 0;
      if (!fileName.toLowerCase().endsWith('.xmp') || size < 1 || size > MAX_PRESET_BYTES) {
        Alert.alert(t.uploads.presetInvalid);
        return;
      }
      const content = await file.text();
      if (!/<x:xmpmeta[\s>]/i.test(content)) {
        Alert.alert(t.uploads.presetInvalid);
        return;
      }

      const preset = await data.uploadAlbumPreset(albumId, { fileName, content });
      if (!mounted.current) return;
      setList((current) => ({
        status: 'ready',
        presets: [preset, ...(current.status === 'ready' ? current.presets.filter((p) => p.path !== preset.path) : [])],
      }));
      onChange(preset.path);
    } catch {
      if (mounted.current) Alert.alert(t.uploads.presetAddFailed);
    } finally {
      addingRef.current = false;
      onBusyChange(false);
      if (mounted.current) setAdding(false);
    }
  }

  const options: { path: string | null; name: string; detail?: string }[] = [
    { path: null, name: t.uploads.presetNone },
    ...(list.status === 'ready'
      ? list.presets.map((preset) => ({
          path: preset.path,
          name: preset.name,
          detail: preset.path.split('/')[1] === 'presets' ? t.uploads.presetAccountWide : undefined,
        }))
      : []),
  ];

  return (
    <View pointerEvents={disabled ? 'none' : 'auto'}>
      <Card>
        <ThemedText type="small" themeColor="textSecondary">{t.uploads.presetLabel}</ThemedText>

        <View accessibilityRole="radiogroup" style={styles.options}>
          {options.map((option) => {
            const selected = option.path === value;
            return (
              <Pressable
                key={option.path ?? 'none'}
                onPress={() => onChange(option.path)}
                accessibilityRole="radio"
                accessibilityState={{ selected, disabled }}
                style={({ pressed }) => [
                  styles.option,
                  { borderColor: selected ? theme.text : theme.line, backgroundColor: theme.surface },
                  pressed && styles.pressed,
                ]}>
                <View style={styles.optionText}>
                  <ThemedText type="smallBold" numberOfLines={1}>{option.name}</ThemedText>
                  {option.detail ? (
                    <ThemedText type="small" themeColor="textSecondary">{option.detail}</ThemedText>
                  ) : null}
                </View>
                {selected ? (
                  <SymbolView name="checkmark" size={16} tintColor={theme.text}
                    fallback={<ThemedText type="smallBold">✓</ThemedText>} />
                ) : null}
              </Pressable>
            );
          })}
        </View>

        {list.status === 'loading' ? (
          <ThemedText type="small" themeColor="textSecondary">{t.uploads.presetLoading}</ThemedText>
        ) : list.status === 'error' ? (
          <View style={styles.errorRow}>
            <ThemedText type="small" style={[styles.flex, { color: theme.danger }]}>{t.uploads.presetLoadFailed}</ThemedText>
            <Pressable onPress={reload} accessibilityRole="button" hitSlop={10}>
              <ThemedText type="smallBold" style={{ color: theme.accentDeep }}>{t.common.retry}</ThemedText>
            </Pressable>
          </View>
        ) : null}

        <Button
          label={adding ? t.uploads.presetAdding : t.uploads.presetAdd}
          onPress={addPreset}
          variant="secondary"
          loading={adding}
          disabled={disabled}
        />
        <ThemedText type="small" themeColor="textSecondary">{t.uploads.presetHint}</ThemedText>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  options: { gap: Spacing.two },
  option: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.control,
  },
  optionText: { flex: 1, gap: Spacing.half },
  pressed: { opacity: 0.7 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  flex: { flex: 1 },
});
