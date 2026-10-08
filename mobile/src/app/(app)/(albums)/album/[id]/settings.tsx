import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Field, LoadingView, Segmented, StateView, SwitchRow } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useQuery } from '@/hooks/use-query';
import { useTheme } from '@/hooks/use-theme';
import { data, type Album, type DownloadSize } from '@/lib/data';
import { describeError, useT } from '@/lib/i18n';

export default function AlbumSettingsScreen() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const album = useQuery(() => data.fetchAlbum(id));

  if (album.data) {
    // Keyed by id so the form's initial values always come from this album.
    return <SettingsForm key={album.data.id} album={album.data} />;
  }

  if (album.loading) return <LoadingView />;

  return (
    <StateView
      title={describeError(t, album.error)}
      actionLabel={t.common.retry}
      onAction={album.refresh}
    />
  );
}

function SettingsForm({ album }: { album: Album }) {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const [title, setTitle] = useState(album.title ?? '');
  const [description, setDescription] = useState(album.description ?? '');
  const [allowDownload, setAllowDownload] = useState(album.allowDownload);
  const [downloadSize, setDownloadSize] = useState<DownloadSize>(album.downloadSize);
  const [isPasswordProtected, setIsPasswordProtected] = useState(album.isPasswordProtected);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'saving' | 'deleting' | null>(null);
  const [error, setError] = useState('');

  const displayTitle = album.title?.trim() || t.albums.untitled;

  async function handleSave() {
    if (busy) return;

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError(t.newAlbum.nameRequired);
      return;
    }

    // Turning protection on for the first time needs an actual password;
    // otherwise the album would be marked protected with nothing to check.
    if (isPasswordProtected && !album.isPasswordProtected && !password.trim()) {
      setError(t.settings.passwordRequired);
      return;
    }

    setBusy('saving');
    setError('');

    try {
      await data.updateAlbumSettings({
        albumId: album.id,
        title: trimmedTitle,
        description: description.trim(),
        allowDownload,
        downloadSize,
        isPasswordProtected,
        password: isPasswordProtected ? password.trim() : '',
      });
      router.back();
    } catch (saveError) {
      setError(describeError(t, saveError));
      setBusy(null);
    }
  }

  function confirmDelete() {
    if (busy) return;

    Alert.alert(t.settings.deleteTitle, t.settings.deleteMessage(displayTitle), [
      { text: t.common.cancel, style: 'cancel' },
      { text: t.common.delete, style: 'destructive', onPress: handleDelete },
    ]);
  }

  async function handleDelete() {
    setBusy('deleting');
    setError('');

    try {
      await data.deleteAlbum(album.id);
      // Leave both this screen and the deleted album's page.
      router.dismissAll();
    } catch (deleteError) {
      setError(describeError(t, deleteError));
      setBusy(null);
    }
  }

  const sizeOptions: { value: DownloadSize; label: string }[] = [
    { value: 'sd', label: t.settings.sizes.sd },
    { value: 'hd', label: t.settings.sizes.hd },
    { value: 'uhd', label: t.settings.sizes.uhd },
    { value: 'original', label: t.settings.sizes.original },
  ];

  return (
    // The scroll view is the screen's root so the tab bar and header inset it;
    // wrapped in another view, its last rows end up underneath the tab bar.
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled">
      <ThemedText type="smallBold" themeColor="textSecondary">
        {t.settings.details}
      </ThemedText>
      <Card>
        <Field label={t.newAlbum.nameLabel} value={title} onChangeText={setTitle} maxLength={120} />
        <Field
          label={t.newAlbum.descriptionLabel}
          value={description}
          onChangeText={setDescription}
          placeholder={t.newAlbum.descriptionPlaceholder}
          multiline
          maxLength={500}
        />
      </Card>

      <ThemedText type="smallBold" themeColor="textSecondary">
        {t.settings.sharing}
      </ThemedText>
      <Card>
        <SwitchRow
          label={t.settings.allowDownload}
          value={allowDownload}
          onValueChange={setAllowDownload}
        />
        {allowDownload ? (
          <View style={styles.group}>
            <ThemedText type="small" themeColor="textSecondary">
              {t.settings.downloadSize}
            </ThemedText>
            <Segmented options={sizeOptions} value={downloadSize} onChange={setDownloadSize} />
          </View>
        ) : null}
        <SwitchRow
          label={t.settings.passwordProtect}
          value={isPasswordProtected}
          onValueChange={(next) => {
            setIsPasswordProtected(next);
            // A "set a password" message no longer applies once this changes.
            setError('');
          }}
        />
        {isPasswordProtected ? (
          <Field
            label={album.isPasswordProtected ? t.settings.passwordKeep : t.settings.passwordNew}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="newPassword"
            maxLength={128}
          />
        ) : null}
      </Card>

      {error ? (
        <ThemedText type="small" accessibilityRole="alert" style={{ color: theme.danger }}>
          {error}
        </ThemedText>
      ) : null}

      <Button
        label={busy === 'saving' ? t.common.saving : t.common.save}
        onPress={handleSave}
        loading={busy === 'saving'}
        disabled={busy === 'deleting'}
      />
      <Button
        label={busy === 'deleting' ? t.settings.deleting : t.settings.deleteAlbum}
        onPress={confirmDelete}
        variant="danger"
        loading={busy === 'deleting'}
        disabled={busy === 'saving'}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three },
  group: { gap: Spacing.two },
});
