import { useFocusEffect, useIsFocused, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Field, LoadingView, StateView } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/ctx/session';
import { useAlbumCoverGuard } from '@/hooks/use-album-cover-guard';
import { useTheme } from '@/hooks/use-theme';
import { albumAccessDraft, hasAlbumAccessChanges, validateAlbumAccessDraft, type AlbumAccessDraft } from '@/lib/album-access-draft';
import { isAlbumAccessEditingAvailable } from '@/lib/album-access-release';
import { isDemoMode } from '@/lib/config';
import { data } from '@/lib/data';
import { DataError, type AlbumAccessSettings, type DownloadSize } from '@/lib/data/types';
import { describeError, useT } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';

type Prompt = { cancel: () => void };

export default function AlbumAccessScreen() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useSession();
  if (!user) return <StateView title={t.common.errorSession} />;
  // The new endpoint is prepared locally, not implicitly released by this UI.
  if (!isAlbumAccessEditingAvailable()) {
    return <StateView title={t.access.pending} hint={t.access.pendingHint} />;
  }
  if (typeof id !== 'string' || !id.trim()) return <StateView title={t.common.errorNotFound} />;
  return <OwnedAlbumAccessScreen key={`${user.id}:${id}`} albumId={id} accountId={user.id} />;
}

function OwnedAlbumAccessScreen({ albumId, accountId }: { albumId: string; accountId: string }) {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const focused = useIsFocused();
  const guard = useAlbumCoverGuard(albumId, focused);
  const capture = guard.capture;
  const [settings, setSettings] = useState<AlbumAccessSettings | null>(null);
  const [draft, setDraft] = useState<AlbumAccessDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');
  const [requiresReload, setRequiresReload] = useState(false);
  const [authorized, setAuthorized] = useState(true);
  const [reload, setReload] = useState(0);
  const requiresReloadRef = useRef(false);
  const draftRef = useRef<AlbumAccessDraft | null>(null);
  const draftRevision = useRef(0);
  const busyRef = useRef(false);
  const completed = useRef(false);
  const leaving = useRef(false);
  const confirmation = useRef<Prompt | null>(null);
  const discardDialog = useRef<object | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; confirmation.current?.cancel(); };
  }, []);

  const clearDraft = useCallback(() => {
    draftRef.current = null;
    draftRevision.current += 1;
    discardDialog.current = null;
    confirmation.current?.cancel();
    setDraft(null);
    setSettings(null);
    setLoading(true);
    setError('');
    setWaiting(false);
    requiresReloadRef.current = false;
    setRequiresReload(false);
  }, []);

  useEffect(() => {
    if (isDemoMode) return;
    let observedOwner: string | null = accountId;
    let subscribed = true;
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!subscribed) return;
      const nextOwner = next?.user.id ?? null;
      if (nextOwner !== observedOwner) clearDraft();
      observedOwner = nextOwner;
      setAuthorized(nextOwner === accountId);
    });
    return () => { subscribed = false; listener.subscription.unsubscribe(); };
  }, [accountId, clearDraft]);

  useFocusEffect(useCallback(() => () => {
    // Access/password drafts are memory-only and cannot survive another visit.
    clearDraft();
  }, [clearDraft]));

  useEffect(() => {
    const current = capture();
    if (!current?.() || !isAlbumAccessEditingAvailable()) return;
    let active = true;
    void data.fetchAlbumAccess(albumId, { expectedOwnerId: accountId, isCurrent: () => active && current() }).then(next => {
      if (!active || !current() || next.albumId !== albumId) return;
      const nextDraft = albumAccessDraft(next);
      draftRef.current = nextDraft;
      draftRevision.current += 1;
      setSettings(next);
      setDraft(nextDraft);
      requiresReloadRef.current = false;
      setRequiresReload(false);
    }).catch(readError => {
      if (active && current()) setError(describeError(t, readError));
    }).finally(() => {
      if (active && current()) setLoading(false);
    });
    return () => { active = false; };
  }, [accountId, albumId, capture, reload, t]);

  function change<K extends keyof AlbumAccessDraft>(field: K, value: AlbumAccessDraft[K]) {
    const current = guard.capture();
    if (!current?.() || busyRef.current || requiresReloadRef.current || !isAlbumAccessEditingAvailable() ||
      completed.current || leaving.current || !draftRef.current) return;
    discardDialog.current = null;
    draftRevision.current += 1;
    const next = { ...draftRef.current, [field]: value };
    if (field === 'isPasswordProtected' && value === false) next.password = '';
    draftRef.current = next;
    setDraft(next);
    setError('');
  }

  function reloadLatest() {
    if (!guard.capture()?.() || busyRef.current) return;
    // The button explicitly says this discards the local draft, not remote data.
    clearDraft();
    setReload(value => value + 1);
  }

  async function requestSave() {
    const current = guard.capture();
    const edited = draftRef.current;
    if (!current?.() || !settings || !edited || busyRef.current || requiresReloadRef.current ||
      completed.current || leaving.current || !isAlbumAccessEditingAvailable()) return;
    const validation = validateAlbumAccessDraft(settings, edited);
    if (validation) {
      setError(validation === 'password-required' ? t.access.passwordRequired
        : validation === 'password-too-long' ? t.access.passwordTooLong : t.common.errorGeneric);
      return;
    }
    if (!hasAlbumAccessChanges(settings, edited)) return;
    const revision = draftRevision.current;
    const candidate = { ...edited, password: edited.isPasswordProtected ? edited.password.trim() : '' };
    const stillCurrent = () => current() && draftRevision.current === revision;
    busyRef.current = true;
    setBusy(true);
    setChecking(true);
    setWaiting(false);
    setError('');

    try {
      // Review a fresh server snapshot before asking the owner to change access.
      const fresh = await data.fetchAlbumAccess(albumId, { expectedOwnerId: accountId, isCurrent: stillCurrent });
      if (!stillCurrent()) return;
      if (fresh.albumId !== albumId) throw new DataError('server');
      if (fresh.revision !== settings.revision) {
        const nextDraft = albumAccessDraft(fresh);
        draftRef.current = nextDraft;
        draftRevision.current += 1;
        setSettings(fresh);
        setDraft(nextDraft);
        setError(t.access.changed);
        return;
      }
      setChecking(false);
      // Native prompt callbacks have both a one-use ticket and visit/account fence.
      await new Promise<void>((resolve, reject) => {
        let phase: 'prompt' | 'writing' | 'settled' = 'prompt';
        const ticket: Prompt = { cancel() {
          if (phase !== 'prompt') return;
          phase = 'settled';
          if (confirmation.current === ticket) confirmation.current = null;
          resolve();
        } };
        confirmation.current = ticket;
        const save = async () => {
          if (phase !== 'prompt') return;
          if (confirmation.current !== ticket || !stillCurrent() || !isAlbumAccessEditingAvailable()) {
            ticket.cancel();
            return;
          }
          phase = 'writing';
          try {
            await data.updateAlbumAccess({ albumId, ...candidate, revision: fresh.revision },
              { expectedOwnerId: accountId, isCurrent: stillCurrent });
            if (stillCurrent()) {
              completed.current = true;
              draftRef.current = null;
              draftRevision.current += 1;
              setDraft(null);
              router.back();
            }
            resolve();
          } catch (saveError) { reject(saveError); }
          finally {
            phase = 'settled';
            if (confirmation.current === ticket) confirmation.current = null;
          }
        };
        try {
          const summary = [
            candidate.allowDownload ? `${t.access.allowDownload}: ${t.settings.sizes[candidate.downloadSize]}` : t.delivery.downloadsOff,
            candidate.isPasswordProtected ? t.delivery.protected : t.delivery.unprotected,
            t.access.reviewHint,
          ].join('\n');
          Alert.alert(t.access.reviewTitle, summary, [
            { text: t.common.cancel, style: 'cancel', onPress: ticket.cancel },
            { text: t.access.confirm, onPress: () => { void save(); } },
          ], { cancelable: true, onDismiss: ticket.cancel });
        } catch (promptError) {
          phase = 'settled';
          if (confirmation.current === ticket) confirmation.current = null;
          reject(promptError);
        }
      });
    } catch (saveError) {
      if (stillCurrent()) {
        setError(saveError instanceof DataError && saveError.kind === 'conflict'
          ? t.access.changed : describeError(t, saveError));
        // No automatic resubmission or cached-state fallback after ambiguity.
        requiresReloadRef.current = true;
        setRequiresReload(true);
        const next = { ...candidate, password: '' };
        draftRef.current = next;
        draftRevision.current += 1;
        setDraft(next);
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) { setBusy(false); setChecking(false); setWaiting(false); }
    }
  }

  const dirty = Boolean(settings && draft && hasAlbumAccessChanges(settings, draft));
  usePreventRemove(focused && authorized && (dirty || busy), ({ data: removal }) => {
    const current = guard.capture();
    if (!current?.() || leaving.current) return;
    if (completed.current) {
      leaving.current = true;
      navigation.dispatch(removal.action);
      return;
    }
    if (busyRef.current) { setWaiting(true); return; }
    if (discardDialog.current) return;
    const ticket = {};
    const revision = draftRevision.current;
    discardDialog.current = ticket;
    const cancel = () => { if (discardDialog.current === ticket) discardDialog.current = null; };
    try {
      Alert.alert(t.access.discardTitle, t.access.discardMessage, [
        { text: t.access.keepEditing, style: 'cancel', onPress: cancel },
        { text: t.access.discard, style: 'destructive', onPress: () => {
          if (discardDialog.current !== ticket || !current() || busyRef.current ||
            completed.current || leaving.current || draftRevision.current !== revision) return;
          cancel();
          leaving.current = true;
          clearDraft();
          navigation.dispatch(removal.action);
        } },
      ], { cancelable: true, onDismiss: cancel });
    } catch { cancel(); }
  });

  if (!authorized) return <StateView title={t.common.errorSession} />;
  if (!settings || !draft) {
    if (loading) return <LoadingView />;
    return <StateView title={error || t.common.errorNotFound} actionLabel={t.common.retry} onAction={reloadLatest} />;
  }
  const editable = guard.available && focused && !busy && !requiresReload;
  const sizes: DownloadSize[] = ['sd', 'hd', 'uhd', 'original'];
  return <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}
    contentInsetAdjustmentBehavior="automatic" automaticallyAdjustKeyboardInsets
    keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled">
    <ThemedText type="small" themeColor="textSecondary">{t.access.intro}</ThemedText>
    <Card>
      <View style={styles.row}>
        <ThemedText style={styles.label}>{t.access.allowDownload}</ThemedText>
        <Switch accessibilityLabel={t.access.allowDownload} value={draft.allowDownload} disabled={!editable}
          onValueChange={value => change('allowDownload', value)} trackColor={{ true: theme.accent, false: theme.backgroundSelected }} />
      </View>
      {draft.allowDownload ? <>
        <ThemedText type="smallBold">{t.access.downloadSize}</ThemedText>
        {sizes.map(size => <Button key={size} variant={draft.downloadSize === size ? 'primary' : 'secondary'}
          label={t.settings.sizes[size]} disabled={!editable} onPress={() => change('downloadSize', size)} />)}
        <ThemedText type="small" themeColor="textSecondary">{t.uploads.sizeHints[draft.downloadSize]}</ThemedText>
      </> : null}
    </Card>
    <Card>
      <View style={styles.row}>
        <ThemedText style={styles.label}>{t.access.passwordProtection}</ThemedText>
        <Switch accessibilityLabel={t.access.passwordProtection} value={draft.isPasswordProtected} disabled={!editable}
          onValueChange={value => change('isPasswordProtected', value)} trackColor={{ true: theme.accent, false: theme.backgroundSelected }} />
      </View>
      {draft.isPasswordProtected ? <>
        <Field label={t.access.passwordLabel} value={draft.password} onChangeText={value => change('password', value)}
          editable={editable} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" maxLength={72} />
        <ThemedText type="small" themeColor="textSecondary">
          {settings.isPasswordProtected ? t.access.passwordKeep : t.access.passwordRequired}
        </ThemedText>
      </> : null}
    </Card>
    <ThemedText type="small" themeColor="textSecondary">{t.access.draftHint}</ThemedText>
    {error ? <ThemedText accessibilityRole="alert" style={{ color: theme.danger }}>{error}</ThemedText> : null}
    {requiresReload ? <Card>
      <ThemedText type="small" themeColor="textSecondary">{t.access.reloadHint}</ThemedText>
      <Button label={t.access.reload} onPress={reloadLatest} disabled={busy || !guard.available} variant="secondary" />
    </Card> : null}
    {waiting ? <Card>
      <ThemedText type="smallBold">{t.access.waiting}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{t.access.waitHint}</ThemedText>
    </Card> : null}
    <Button label={checking ? t.access.checking : busy ? t.common.saving : t.access.save}
      onPress={() => { void requestSave(); }} loading={busy} disabled={!editable || !dirty} />
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  label: { flex: 1 },
});
