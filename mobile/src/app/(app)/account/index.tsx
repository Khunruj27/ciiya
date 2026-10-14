import Constants from 'expo-constants';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { useIsFocused } from 'expo-router';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Segmented, StateView, formatBytes } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/ctx/session';
import { useLanguage } from '@/ctx/language';
import { useAccountUsage } from '@/hooks/use-account-usage';
import { useAlbumCoverGuard } from '@/hooks/use-album-cover-guard';
import { useTheme } from '@/hooks/use-theme';
import { isDemoMode, SITE_URL } from '@/lib/config';
import { createAccountActions } from '@/lib/account-actions';
import { summarizeStorageUsage } from '@/lib/account-usage';
import { describeError, useT } from '@/lib/i18n';

const PLAN_NAMES: Record<string, string> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  business: 'Business',
};

export default function AccountScreen() {
  const { user } = useSession();
  return <OwnedAccountScreen key={user?.id ?? ''} accountId={user?.id ?? ''} />;
}

function OwnedAccountScreen({ accountId }: { accountId: string }) {
  const t = useT();
  const language = useLanguage();
  const theme = useTheme();
  const { user, signOut } = useSession();
  const usage = useAccountUsage(accountId);
  const guard = useAlbumCoverGuard('account', useIsFocused());
  const [busyOwner, setBusyOwner] = useState<object | null>(null);
  const signOutRef = useRef(signOut);
  useLayoutEffect(() => { signOutRef.current = signOut; }, [signOut]);
  // Only store a callback here; the current provider is read when the human
  // confirms, not during render. Token refresh must not reset single-flight.
  const actionScope = useMemo(() => {
    const busyKey = {};
    // The audited factory stores ports without reading or invoking them.
    // eslint-disable-next-line react-hooks/refs
    return { busyKey, actions: createAccountActions({
      capture: guard.capture,
      signOut: () => signOutRef.current(),
      onBusy: busy => setBusyOwner(busy ? busyKey : null),
      onError: () => Alert.alert(t.account.signOutFailed),
    }) };
  }, [guard.capture, t]);
  const { actions } = actionScope;
  // A new lifetime derives idle state immediately; no effect-driven reset or
  // late completion can paint another account's busy state.
  const signingOut = busyOwner === actionScope.busyKey;
  useEffect(() => {
    actions.activate();
    return actions.dispose;
  }, [actions]);

  function handleSignOut() {
    const confirmation = actions.requestSignOut();
    if (!confirmation) return;
    try {
      Alert.alert(t.account.signOutTitle, t.account.signOutHint, [
        { text: t.common.cancel, style: 'cancel', onPress: confirmation.cancel },
        { text: t.account.signOut, style: 'destructive', onPress: () => { void confirmation.confirm(); } },
      ], { cancelable: true, onDismiss: confirmation.cancel });
    } catch { confirmation.cancel(); }
  }

  async function openInfo(path: '/privacy' | '/terms' | '/support') {
    try { await Linking.openURL(`${SITE_URL}${path}`); }
    catch { Alert.alert(t.common.errorGeneric); }
  }

  const displayName = user?.name || user?.email || '';
  const initial = displayName.trim().charAt(0).toUpperCase() || 'C';
  const storage = usage.data ? summarizeStorageUsage(usage.data) : null;
  const planName = storage ? PLAN_NAMES[storage.plan] ?? t.account.unknownPlan : '';
  const fraction = storage?.fraction ?? 0;
  const version = Constants.expoConfig?.version ?? '';

  if (!accountId || !usage.authorized || user?.id !== accountId) {
    return <StateView title={t.common.errorSession} />;
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={
        <RefreshControl
          refreshing={usage.refreshing}
          onRefresh={usage.refresh}
          tintColor={theme.accentDeep}
          enabled={!signingOut}
        />
      }>
      <Card>
        <View style={styles.identity}>
          <View style={[styles.avatar, { backgroundColor: theme.accentSoft }]}>
            {user?.avatarUrl ? (
              <Image
                source={{ uri: user.avatarUrl }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                recyclingKey={accountId}
              />
            ) : (
              <ThemedText style={[styles.avatarInitial, { color: theme.accentDeep }]}>
                {initial}
              </ThemedText>
            )}
          </View>
          <View style={styles.identityText}>
            {user?.name ? (
              <ThemedText numberOfLines={1} style={styles.name}>
                {user.name}
              </ThemedText>
            ) : null}
            {user?.email ? (
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {user.email}
              </ThemedText>
            ) : null}
          </View>
        </View>
      </Card>

      {storage ? (
        <Card>
          <View style={styles.rowBetween}>
            <ThemedText type="smallBold">{t.account.storage}</ThemedText>
            {planName ? (
              <View style={[styles.badge, { backgroundColor: theme.accentSoft }]}>
                <ThemedText type="smallBold" style={{ color: theme.accentDeep }}>
                  {planName}
                </ThemedText>
              </View>
            ) : null}
          </View>
          {storage.limitBytes !== null ? (
            <View
              style={[styles.track, { backgroundColor: theme.backgroundElement }]}
              accessibilityRole="progressbar"
              accessibilityLabel={t.account.storage}
              accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}>
              <View
                style={[
                  styles.fill,
                  {
                    width: `${Math.max(fraction * 100, storage.usedBytes > 0 ? 2 : 0)}%`,
                    backgroundColor: fraction >= 0.9 ? theme.danger : theme.accent,
                  },
                ]}
              />
            </View>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">
            {storage.limitBytes !== null
              ? t.account.storageUsed(formatBytes(storage.usedBytes), formatBytes(storage.limitBytes))
              : `${t.account.used}: ${formatBytes(storage.usedBytes)}`}
          </ThemedText>
          {storage.remainingBytes !== null ? (
            <ThemedText type="smallBold">{t.account.remaining}: {formatBytes(storage.remainingBytes)}</ThemedText>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">{t.account.capacityUnknown}</ThemedText>
          )}
          {storage.level === 'full' || storage.level === 'near-full' ? (
            <ThemedText type="small" style={{ color: theme.danger }}>
              {storage.level === 'full' ? t.account.quotaFull : t.account.quotaNearFull}
            </ThemedText>
          ) : null}
          {usage.error ? (
            <ThemedText type="small" themeColor="textSecondary">{t.account.usageCached}</ThemedText>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">{t.account.quotaReadOnly}</ThemedText>
          <Button label={t.account.refresh} onPress={usage.refresh} variant="secondary"
            loading={usage.refreshing} disabled={signingOut || !guard.available} />
        </Card>
      ) : null}

      {usage.loading && !usage.data ? <ActivityIndicator color={theme.accentDeep} /> : null}
      {usage.error ? (
        <Card>
          <ThemedText accessibilityRole="alert" style={{ color: theme.danger }}>
            {t.account.usageUnavailable}
          </ThemedText>
          {!usage.data ? (
            <ThemedText type="small" themeColor="textSecondary">{t.account.usageUnavailableHint}</ThemedText>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">{describeError(t, usage.error)}</ThemedText>
          <Button label={t.common.retry} onPress={usage.refresh} loading={usage.refreshing}
            disabled={signingOut || !guard.available} variant="secondary" />
        </Card>
      ) : null}

      {language ? (
        <Card>
          <ThemedText type="smallBold">{t.account.language}</ThemedText>
          <Segmented
            options={[
              { value: 'system', label: t.account.languageSystem },
              { value: 'th', label: 'ไทย' },
              { value: 'en', label: 'English' },
            ]}
            value={language.preference}
            disabled={signingOut || !guard.available}
            onChange={value => {
              if (signingOut || !guard.capture()?.()) return;
              void language.selectLanguage(value);
            }}
          />
          <ThemedText type="small" themeColor="textSecondary">{t.account.languageHint}</ThemedText>
          {language.saving ? (
            <ThemedText type="small" themeColor="textSecondary">{t.account.languageSaving}</ThemedText>
          ) : null}
          {language.saveFailed ? (
            <ThemedText type="small" accessibilityRole="alert" style={{ color: theme.danger }}>
              {t.account.languageSaveFailed}
            </ThemedText>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <Button label={t.account.support} onPress={() => openInfo('/support')} variant="secondary" />
        <Button label={t.account.privacy} onPress={() => openInfo('/privacy')} variant="secondary" />
        <Button label={t.account.terms} onPress={() => openInfo('/terms')} variant="secondary" />
      </Card>

      <Button label={t.account.signOut} onPress={handleSignOut} loading={signingOut}
        disabled={!guard.available} variant="secondary" />

      <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
        {[isDemoMode ? t.account.demo : null, version ? t.account.version(version) : null]
          .filter(Boolean)
          .join(' · ')}
      </ThemedText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three },
  identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: Radius.pill,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 22, fontWeight: 700 },
  identityText: { flex: 1, gap: Spacing.half },
  name: { fontSize: 17, fontWeight: 600 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { paddingHorizontal: Spacing.two + Spacing.one, paddingVertical: Spacing.one, borderRadius: Radius.pill },
  track: { height: 8, borderRadius: Radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radius.pill },
  footnote: { textAlign: 'center' },
});
