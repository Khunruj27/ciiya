import { useFocusEffect, useIsFocused, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
// SDK 57 exposes this through the documented compatibility entry point. The
// different `expo-router` usePreventRemove({ repeat }) API starts with SDK 58.
import { usePreventRemove } from 'expo-router/react-navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Field, LoadingView, StateView } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/ctx/session';
import { useQuery } from '@/hooks/use-query';
import { useTheme } from '@/hooks/use-theme';
import { isAlbumEditingAvailable } from '@/lib/album-edit-release';
import { isAlbumAccessEditingAvailable } from '@/lib/album-access-release';
import { isDemoMode } from '@/lib/config';
import { data, type Album } from '@/lib/data';
import { describeError, useT } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';

export default function AlbumSettingsScreen() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useSession();
  if (!user) return <StateView title={t.common.errorSession} />;

  // Cached details and queued save callbacks cannot cross an account/album.
  return <AlbumSettingsLoader key={`${user.id}:${id}`} albumId={id} accountId={user.id} />;
}

function AlbumSettingsLoader({ albumId, accountId }: { albumId: string; accountId: string }) {
  const t = useT();
  const album = useQuery(() => data.fetchAlbum(albumId));

  if (album.data?.id === albumId) {
    return <>
      {album.error ? <StateView title={describeError(t, album.error)} actionLabel={t.common.retry} onAction={album.refresh} /> : null}
      <SettingsForm
        key={`${accountId}:${albumId}`}
        album={album.data}
        accountId={accountId}
        eligible={!album.error && !album.loading && !album.refreshing}
      />
    </>;
  }

  if (album.loading) return <LoadingView />;

  return (
    <StateView
      title={album.error ? describeError(t, album.error) : t.common.errorNotFound}
      actionLabel={t.common.retry}
      onAction={album.refresh}
    />
  );
}

function SettingsForm({ album, accountId, eligible = true }: {
  album: Album;
  accountId: string;
  eligible?: boolean;
}) {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const focused = useIsFocused();
  const editingAvailable = isAlbumEditingAvailable();
  const [initialDraft] = useState(() => ({ title: album.title ?? '', description: album.description ?? '' }));
  const [title, setTitle] = useState(initialDraft.title);
  const [description, setDescription] = useState(initialDraft.description);
  const [busy, setBusy] = useState(false);
  const [waitingToLeave, setWaitingToLeave] = useState(false);
  const [error, setError] = useState('');
  const [authAllowed, setAuthAllowed] = useState(Boolean(accountId));
  const busyRef = useRef(false);
  const completed = useRef(false);
  const leaving = useRef(false);
  const draft = useRef(initialDraft);
  const draftRevision = useRef(0);
  const exitDialog = useRef<{ generation: number; revision: number } | null>(null);
  const context = useRef({ focused, eligible, authorized: Boolean(accountId), generation: 0 });
  const hasChanges = title !== initialDraft.title || description !== initialDraft.description;

  useLayoutEffect(() => {
    context.current.focused = focused;
    context.current.eligible = eligible;
  }, [eligible, focused]);

  useEffect(() => {
    if (isDemoMode) return;
    const activeContext = context.current;
    let subscribed = true;
    let observedOwner: string | null = accountId;
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!subscribed) return;
      const nextOwner = next?.user.id ?? null;
      // Fence immediately in the auth event, before React replaces the form.
      if (nextOwner !== observedOwner) {
        activeContext.generation += 1;
        exitDialog.current = null;
      }
      observedOwner = nextOwner;
      activeContext.authorized = Boolean(accountId && nextOwner === accountId);
      setAuthAllowed(activeContext.authorized);
    });
    return () => {
      subscribed = false;
      activeContext.authorized = false;
      activeContext.generation += 1;
      exitDialog.current = null;
      listener.subscription.unsubscribe();
    };
  }, [accountId]);

  useFocusEffect(useCallback(() => {
    const activeContext = context.current;
    activeContext.focused = true;
    return () => {
      activeContext.focused = false;
      activeContext.generation += 1;
      exitDialog.current = null;
    };
  }, []));

  function changeDraft(field: 'title' | 'description', value: string) {
    const activeContext = context.current;
    if (busyRef.current || completed.current || leaving.current || !activeContext.focused ||
      !activeContext.eligible || !activeContext.authorized || !isAlbumEditingAvailable()) return;
    // An old dialog must not discard text entered after it opened, including an
    // edit away and back before React commits. No draft is persisted or sent here.
    exitDialog.current = null;
    draftRevision.current += 1;
    draft.current = { ...draft.current, [field]: value };
    if (field === 'title') setTitle(value);
    else setDescription(value);
    setError('');
  }

  usePreventRemove(focused && authAllowed && (hasChanges || busy), ({ data: removal }) => {
    const activeContext = context.current;
    if (!activeContext.focused || !activeContext.authorized || leaving.current) return;
    if (completed.current) {
      // A save is acknowledged before router.back(), possibly before the hook's
      // next render. Repeat this exact SDK-57 action, not a new back action.
      leaving.current = true;
      navigation.dispatch(removal.action);
      return;
    }
    if (exitDialog.current) return;
    if (busyRef.current) {
      // Keep this feedback in the form. A native "waiting" alert could outlive
      // the request and cover the next screen after an acknowledged save.
      setWaitingToLeave(true);
      return;
    }
    if (draft.current.title === initialDraft.title && draft.current.description === initialDraft.description) {
      leaving.current = true;
      navigation.dispatch(removal.action);
      return;
    }
    const ticket = { generation: activeContext.generation, revision: draftRevision.current };
    const dismiss = () => { if (exitDialog.current === ticket) exitDialog.current = null; };
    exitDialog.current = ticket;
    Alert.alert(t.settings.discardTitle, t.settings.discardMessage, [
      { text: t.settings.keepEditing, style: 'cancel', onPress: dismiss },
      { text: t.settings.discardChanges, style: 'destructive', onPress: () => {
        if (exitDialog.current !== ticket) return;
        dismiss();
        if (activeContext.generation !== ticket.generation || !activeContext.focused ||
          !activeContext.authorized || busyRef.current || completed.current || leaving.current ||
          draftRevision.current !== ticket.revision) return;
        // This removes only this screen's unsaved text, never an album/photo.
        leaving.current = true;
        draft.current = initialDraft;
        draftRevision.current += 1;
        setTitle(initialDraft.title);
        setDescription(initialDraft.description);
        navigation.dispatch(removal.action);
      } },
    ], { cancelable: true, onDismiss: dismiss });
  });

  async function handleSave() {
    const activeContext = context.current;
    if (busyRef.current || completed.current || leaving.current || !activeContext.focused ||
      !activeContext.eligible || !activeContext.authorized) return;
    if (!isAlbumEditingAvailable()) {
      setError(t.settings.editPendingMessage);
      return;
    }

    if (draft.current.title !== title || draft.current.description !== description) return;
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    if (!trimmedTitle) {
      setError(t.newAlbum.nameRequired);
      return;
    }

    if (trimmedTitle.length > 120 || trimmedDescription.length > 500) {
      setError(t.settings.detailsTooLong);
      return;
    }

    const generation = activeContext.generation;
    const current = () => activeContext.generation === generation &&
      activeContext.focused && activeContext.eligible && activeContext.authorized;
    // Lock before awaiting, so callbacks queued by rapid taps cannot overlap.
    exitDialog.current = null;
    busyRef.current = true;
    setBusy(true);
    setWaitingToLeave(false);
    setError('');

    try {
      if (!current()) return;
      await data.updateAlbumDetails({
        albumId: album.id,
        title: trimmedTitle,
        description: trimmedDescription,
      });
      if (!current()) return;
      completed.current = true;
      exitDialog.current = null;
      router.back();
    } catch (saveError) {
      if (current()) setError(describeError(t, saveError));
    } finally {
      exitDialog.current = null;
      busyRef.current = false;
      if (activeContext.focused && activeContext.authorized) {
        setBusy(false);
        setWaitingToLeave(false);
      }
    }
  }

  if (!authAllowed) return <StateView title={t.common.errorSession} />;
  const editable = editingAvailable && eligible && focused && authAllowed && !busy;

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled">
      <ThemedText type="small" themeColor="textSecondary">{t.settings.metadataOnly}</ThemedText>
      {!editingAvailable ? <Card>
        <ThemedText type="smallBold">{t.settings.editPending}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{t.settings.editPendingMessage}</ThemedText>
      </Card> : null}
      <ThemedText type="smallBold" themeColor="textSecondary">
        {t.settings.details}
      </ThemedText>
      <Card>
        <Field label={t.newAlbum.nameLabel} value={title} onChangeText={value => changeDraft('title', value)} maxLength={120} editable={editable} />
        <ThemedText type="small" themeColor="textSecondary" style={styles.counter}>
          {t.settings.characterCount(title.length, 120)}
        </ThemedText>
        <Field
          label={t.newAlbum.descriptionLabel}
          value={description}
          onChangeText={value => changeDraft('description', value)}
          placeholder={t.newAlbum.descriptionPlaceholder}
          multiline
          maxLength={500}
          editable={editable}
        />
        <ThemedText type="small" themeColor="textSecondary" style={styles.counter}>
          {t.settings.characterCount(description.length, 500)}
        </ThemedText>
        <ThemedText type="small" themeColor={hasChanges ? 'accentDeep' : 'textSecondary'} accessibilityLiveRegion="polite">
          {hasChanges ? t.settings.unsavedChanges : t.settings.unchangedDetails}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{t.settings.draftHint}</ThemedText>
      </Card>

      <ThemedText type="smallBold" themeColor="textSecondary">
        {t.settings.sharing}
      </ThemedText>
      <Card>
        <ThemedText type="small" themeColor="textSecondary">
          {isAlbumAccessEditingAvailable() ? t.access.intro : t.settings.sharingReadonly}
        </ThemedText>
        <View style={styles.row}>
          <ThemedText style={styles.label}>{t.delivery.password}</ThemedText>
          <ThemedText type="smallBold" style={styles.value}>
            {album.isPasswordProtected ? t.delivery.protected : t.delivery.unprotected}
          </ThemedText>
        </View>
        <View style={styles.row}>
          <ThemedText style={styles.label}>{t.delivery.downloads}</ThemedText>
          <ThemedText type="smallBold" style={styles.value}>
            {album.allowDownload ? t.settings.sizes[album.downloadSize] : t.delivery.downloadsOff}
          </ThemedText>
        </View>
        <Button label={isAlbumAccessEditingAvailable() ? t.access.edit : t.access.pending}
          variant="secondary" disabled={!isAlbumAccessEditingAvailable() || !editable}
          onPress={() => {
            const activeContext = context.current;
            if (!isAlbumAccessEditingAvailable() || busyRef.current || leaving.current ||
              !activeContext.focused || !activeContext.authorized || !activeContext.eligible) return;
            router.push(`/album/${album.id}/access`);
          }} />
      </Card>

      {error ? (
        <ThemedText type="small" accessibilityRole="alert" style={{ color: theme.danger }}>
          {error}
        </ThemedText>
      ) : null}

      {busy && waitingToLeave ? (
        <ThemedText type="small" themeColor="textSecondary" accessibilityRole="alert">
          {t.settings.saveInProgress} — {t.settings.saveWait}
        </ThemedText>
      ) : null}

      <Button
        label={!editingAvailable ? t.settings.editPending : busy ? t.common.saving : t.common.save}
        onPress={handleSave}
        loading={busy}
        disabled={!editingAvailable || !eligible || !focused || !authAllowed || busy}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  label: { flex: 1 },
  value: { flexShrink: 1, textAlign: 'right' },
  counter: { textAlign: 'right' },
});
