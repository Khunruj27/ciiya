import * as WebBrowser from 'expo-web-browser';
import { Image } from 'expo-image';
import { useFocusEffect, useIsFocused } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Platform, RefreshControl, ScrollView, Share, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, LoadingView, StateView } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAlbumCoverGuard } from '@/hooks/use-album-cover-guard';
import { useQuery } from '@/hooks/use-query';
import { useTheme } from '@/hooks/use-theme';
import {
  createAlbumDeliveryActions,
  getAlbumDeliveryLink,
  type AlbumDeliveryErrorKind,
  type AlbumDeliveryKind,
} from '@/lib/album-delivery';
import { isDemoMode } from '@/lib/config';
import { createAlbumQr } from '@/lib/album-qr';
import { copyGalleryLink, deliveryNativeCapabilities, exportGalleryQr } from '@/lib/delivery-native';
import { data, type Album } from '@/lib/data';
import { describeError, useT } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';

export function AlbumDeliveryPanel({ albumId, accountId, compact = false, uploadComplete = false }: {
  albumId: string; accountId: string; compact?: boolean; uploadComplete?: boolean;
}) {
  const t = useT();
  const theme = useTheme();
  const focused = useIsFocused();
  // Read-only lifetime capture also rejects buttons retained from a prior visit.
  const actionGuard = useAlbumCoverGuard(albumId, focused);
  const album = useQuery(() => data.fetchAlbum(albumId));
  const [busy, setBusy] = useState<AlbumDeliveryKind | null>(null);
  const [actionError, setActionError] = useState('');
  const [authAllowed, setAuthAllowed] = useState(Boolean(accountId));
  const [copied, setCopied] = useState<string | null>(null);
  const [qr, setQr] = useState<Awaited<ReturnType<typeof createAlbumQr>> | null>(null);
  const capabilities = useMemo(() => deliveryNativeCapabilities(), []);
  const [review, setReview] = useState<{ album: Album; source: Album | null } | null>(null);
  // A fresh successful query supersedes an action's review snapshot. A changed
  // security setting is shown here first, never handed straight to the OS.
  const candidate = review?.source === album.data ? review.album : album.data;
  const ownedAlbum = candidate?.id === albumId ? candidate : null;
  const link = getAlbumDeliveryLink(ownedAlbum?.shareToken ?? null);
  // Keep cached details visible on failure, but never share from a failed read.
  const eligible = Boolean(ownedAlbum && link && !album.error && !album.loading && !album.refreshing);
  const context = useRef({ focused, eligible, authorized: Boolean(accountId) });
  const reviewedAlbum = useRef<Album | null>(ownedAlbum);
  const querySource = useRef<Album | null>(album.data);
  useLayoutEffect(() => {
    context.current.focused = focused;
    context.current.eligible = eligible;
    reviewedAlbum.current = ownedAlbum;
    querySource.current = album.data;
  }, [album.data, eligible, focused, ownedAlbum]);

  // The factory only stores callbacks; ref reads happen in events/effects,
  // never while constructing the controller during render.
  // eslint-disable-next-line react-hooks/refs
  const actions = useMemo(() => createAlbumDeliveryActions({
    albumId,
    readAlbum: () => data.fetchAlbum(albumId),
    isCurrent: () => context.current.focused && context.current.eligible && context.current.authorized,
    getReviewedAlbum: () => reviewedAlbum.current,
    onReviewUpdated: (latest) => {
      setQr(null);
      setCopied(null);
      setReview({ album: latest, source: querySource.current });
    },
    platform: Platform.OS,
    shareNative: (content) => Share.share(content),
    previewNative: async (url) => {
      const result = await WebBrowser.openBrowserAsync(url);
      if (result.type === WebBrowser.WebBrowserResultType.LOCKED) throw new Error('Browser unavailable');
      return result;
    },
    copyNative: copyGalleryLink,
    onCopied: setCopied,
    showQr: async (url, isCurrent) => {
      const artifact = await createAlbumQr(url);
      if (isCurrent()) setQr(artifact);
    },
    downloadQrNative: (url, isCurrent) => exportGalleryQr(url, isCurrent, t.delivery.downloadQr),
    makeMessage: t.album.shareMessage,
    untitled: t.albums.untitled,
    onBusy: setBusy,
    onError: (kind: AlbumDeliveryErrorKind) => {
      const messages = {
        unavailable: t.delivery.actionFailed,
        network: t.common.errorNetwork,
        unauthenticated: t.common.errorSession,
        'not-found': t.common.errorNotFound,
        conflict: t.delivery.settingsChanged,
        server: t.common.errorGeneric,
        'settings-changed': t.delivery.settingsChanged,
      };
      setActionError(messages[kind]);
    },
  }), [albumId, t]);

  useEffect(() => {
    if (isDemoMode) return;
    const activeContext = context.current;
    let observedOwner: string | null = accountId;
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      const nextOwner = next?.user.id ?? null;
      const authorized = Boolean(accountId && nextOwner === accountId);
      // Fence old reads immediately in the SDK event, before React can replace
      // the route. Signing out and back into the same account is a new visit.
      if (nextOwner !== observedOwner) {
        actions.dispose();
        setQr(null);
        setCopied(null);
      }
      observedOwner = nextOwner;
      activeContext.authorized = authorized;
      setAuthAllowed(authorized);
      if (authorized && activeContext.focused) actions.activate();
    });
    return () => {
      activeContext.authorized = false;
      actions.dispose();
      listener.subscription.unsubscribe();
    };
  }, [accountId, actions]);

  useFocusEffect(useCallback(() => {
    const activeContext = context.current;
    activeContext.focused = true;
    actions.activate();
    return () => {
      activeContext.focused = false;
      actions.dispose();
      setQr(null);
      setCopied(null);
    };
  }, [actions]));

  function run(kind: AlbumDeliveryKind) {
    const current = actionGuard.capture();
    if (!current?.()) return;
    if (!context.current.focused || !context.current.eligible || !context.current.authorized) return;
    if ((kind === 'copy' && !capabilities.copy) || (kind === 'download-qr' && !capabilities.downloadQr)) return;
    setActionError('');
    setCopied(null);
    if (kind === 'qr') setQr(null);
    void actions.run(kind);
  }

  async function refresh() {
    const current = actionGuard.capture();
    if (!current?.()) return;
    if (busy || album.refreshing) return;
    setActionError('');
    setQr(null);
    setCopied(null);
    await album.refresh();
  }

  if (!authAllowed) return <StateView title={t.common.errorSession} />;

  if (!ownedAlbum) {
    if (album.loading) return <LoadingView />;
    return <StateView
      title={album.error ? describeError(t, album.error) : t.common.errorNotFound}
      actionLabel={t.common.retry}
      onAction={album.refresh}
    />;
  }

  const blocked = !eligible || !focused || !authAllowed || !actionGuard.available || Boolean(busy);
  const content = (
    <View style={styles.content}>
      {compact ? <ThemedText type="subtitle">
        {uploadComplete ? t.delivery.uploadComplete : t.delivery.afterUpload}
      </ThemedText> : null}
      {compact ? <ThemedText type="small" themeColor="textSecondary">{t.uploads.storedHint}</ThemedText> : null}
      <ThemedText themeColor="textSecondary">{t.delivery.intro}</ThemedText>
      <Card>
        <ThemedText type="subtitle">{ownedAlbum.title?.trim() || t.albums.untitled}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {t.albums.photoCount(ownedAlbum.photoCount)}
        </ThemedText>
      </Card>

      <ThemedText type="smallBold" themeColor="textSecondary">{t.delivery.settings}</ThemedText>
      <Card>
        <View style={styles.row}>
          <ThemedText style={styles.label}>{t.delivery.password}</ThemedText>
          <ThemedText type="smallBold" style={styles.value}>
            {ownedAlbum.isPasswordProtected ? t.delivery.protected : t.delivery.unprotected}
          </ThemedText>
        </View>
        {ownedAlbum.isPasswordProtected ? (
          <ThemedText type="small" themeColor="textSecondary">{t.delivery.passwordHint}</ThemedText>
        ) : null}
        <View style={styles.row}>
          <ThemedText style={styles.label}>{t.delivery.downloads}</ThemedText>
          <ThemedText type="smallBold" style={styles.value}>
            {ownedAlbum.allowDownload ? t.settings.sizes[ownedAlbum.downloadSize] : t.delivery.downloadsOff}
          </ThemedText>
        </View>
      </Card>

      {album.error ? (
        <StateView title={describeError(t, album.error)} actionLabel={t.common.retry} onAction={refresh} />
      ) : null}
      {link ? (
        <Card>
          <ThemedText type="smallBold">{t.delivery.link}</ThemedText>
          <ThemedText selectable type="small" themeColor="textSecondary">{link}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{t.delivery.linkHint}</ThemedText>
        </Card>
      ) : (
        <StateView
          title={t.delivery.unavailable}
          hint={t.delivery.unavailableHint}
          actionLabel={t.common.retry}
          onAction={refresh}
        />
      )}

      {actionError ? (
        <ThemedText type="small" accessibilityRole="alert" style={{ color: theme.danger }}>
          {actionError}
        </ThemedText>
      ) : null}
      <Button
        label={busy === 'share' ? t.delivery.sharing : t.delivery.share}
        onPress={() => run('share')}
        loading={busy === 'share'}
        disabled={blocked}
      />
      <Button
        label={busy === 'preview' ? t.delivery.previewing : t.delivery.preview}
        onPress={() => run('preview')}
        variant="secondary"
        loading={busy === 'preview'}
        disabled={blocked}
      />
      <Button
        label={busy === 'copy' ? t.delivery.copying : copied !== null && copied === link ? t.delivery.copied : t.delivery.copy}
        onPress={() => run('copy')} variant="secondary" loading={busy === 'copy'}
        disabled={blocked || !capabilities.copy}
      />
      <Button
        label={busy === 'qr' ? t.delivery.generatingQr : t.delivery.showQr}
        onPress={() => run('qr')} variant="secondary" loading={busy === 'qr'}
        disabled={blocked}
      />
      {qr?.link === link && eligible && focused && authAllowed && actionGuard.available ? (
        <Card>
          <Image source={{ uri: qr.uri }} style={styles.qr} contentFit="contain" transition={0}
            accessibilityLabel={t.delivery.qrLabel} />
          <ThemedText type="small" themeColor="textSecondary">{t.delivery.qrHint}</ThemedText>
        </Card>
      ) : null}
      <Button
        label={busy === 'download-qr' ? t.delivery.exportingQr : t.delivery.downloadQr}
        onPress={() => run('download-qr')} variant="secondary" loading={busy === 'download-qr'}
        disabled={blocked || !capabilities.downloadQr}
      />
      <ThemedText type="small" themeColor="textSecondary">{t.delivery.saveQrHint}</ThemedText>
      {!capabilities.copy || !capabilities.downloadQr ? (
        <ThemedText type="small" themeColor="textSecondary">{t.delivery.updatedBuildRequired}</ThemedText>
      ) : null}
      <ThemedText type="small" themeColor="textSecondary">{t.delivery.noAutomaticSend}</ThemedText>
      <Button
        label={album.refreshing ? t.delivery.refreshing : t.delivery.refresh}
        onPress={refresh}
        variant="secondary"
        loading={album.refreshing}
        disabled={Boolean(busy)}
      />
    </View>
  );
  return compact ? content : <ScrollView contentInsetAdjustmentBehavior="automatic"
    refreshControl={<RefreshControl refreshing={album.refreshing} onRefresh={refresh}
      tintColor={theme.accentDeep} enabled={!busy} />}>{content}</ScrollView>;
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  label: { flex: 1 },
  value: { flexShrink: 1, textAlign: 'right' },
  qr: { width: '100%', height: 260, backgroundColor: '#ffffff' },
});
