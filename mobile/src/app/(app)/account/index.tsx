import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, formatBytes } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/ctx/session';
import { useQuery } from '@/hooks/use-query';
import { useTheme } from '@/hooks/use-theme';
import { isDemoMode } from '@/lib/config';
import { data } from '@/lib/data';
import { useT } from '@/lib/i18n';

const PLAN_NAMES: Record<string, string> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  business: 'Business',
};

export default function AccountScreen() {
  const t = useT();
  const theme = useTheme();
  const { user, signOut } = useSession();
  const usage = useQuery(data.fetchStorageUsage);

  const displayName = user?.name || user?.email || '';
  const initial = displayName.trim().charAt(0).toUpperCase() || 'C';
  const planKey = usage.data?.plan.toLowerCase() ?? '';
  const planName = PLAN_NAMES[planKey] ?? usage.data?.plan ?? '';
  const limit = usage.data?.limitBytes ?? 0;
  const used = usage.data?.usedBytes ?? 0;
  const fraction = limit > 0 ? Math.min(used / limit, 1) : 0;
  const version = Constants.expoConfig?.version ?? '';

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={
        <RefreshControl
          refreshing={usage.refreshing}
          onRefresh={usage.refresh}
          tintColor={theme.accentDeep}
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

      {usage.data ? (
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
          {limit > 0 ? (
            <View
              style={[styles.track, { backgroundColor: theme.backgroundElement }]}
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}>
              <View
                style={[
                  styles.fill,
                  {
                    width: `${Math.max(fraction * 100, used > 0 ? 2 : 0)}%`,
                    backgroundColor: fraction >= 0.9 ? theme.danger : theme.accent,
                  },
                ]}
              />
            </View>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">
            {limit > 0 ? t.account.storageUsed(formatBytes(used), formatBytes(limit)) : formatBytes(used)}
          </ThemedText>
        </Card>
      ) : null}

      <Button label={t.account.signOut} onPress={signOut} variant="secondary" />

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
