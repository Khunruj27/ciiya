import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { HeaderButton, LoadingView, StateView } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useQuery } from '@/hooks/use-query';
import { useTheme } from '@/hooks/use-theme';
import { data, type Album } from '@/lib/data';
import { describeError, useT } from '@/lib/i18n';

export default function AlbumsScreen() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const { data: albums, error, loading, refreshing, refresh } = useQuery(data.fetchAlbums);

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <HeaderButton
              symbol="plus"
              label={t.albums.newAlbum}
              onPress={() => router.push('/new-album')}
            />
          ),
        }}
      />

      {loading && !albums ? (
        <LoadingView />
      ) : (
        <FlatList
          data={albums ?? []}
          keyExtractor={(album) => album.id}
          contentContainerStyle={styles.list}
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.accentDeep} />
          }
          ListEmptyComponent={
            error ? (
              <StateView
                title={describeError(t, error)}
                actionLabel={t.common.retry}
                onAction={refresh}
              />
            ) : (
              <StateView title={t.albums.empty} hint={t.albums.emptyHint} />
            )
          }
          renderItem={({ item }) => <AlbumCard album={item} />}
        />
      )}
    </>
  );
}

function AlbumCard({ album }: { album: Album }) {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/album/[id]', params: { id: album.id } })}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.line },
        pressed && styles.cardPressed,
      ]}>
      <View style={[styles.cover, { backgroundColor: theme.backgroundElement }]}>
        {album.coverUrl ? (
          <Image
            source={{ uri: album.coverUrl }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={150}
          />
        ) : null}
      </View>
      <View style={styles.cardBody}>
        <ThemedText numberOfLines={1} style={styles.cardTitle}>
          {album.title?.trim() || t.albums.untitled}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {t.albums.photoCount(album.photoCount)}
          {album.isPasswordProtected ? ` · ${t.albums.locked}` : ''}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.three, gap: Spacing.three, flexGrow: 1 },
  card: { borderWidth: 1, borderRadius: Radius.card, overflow: 'hidden' },
  cardPressed: { opacity: 0.85 },
  cover: { aspectRatio: 16 / 10, width: '100%' },
  cardBody: { padding: Spacing.three, gap: Spacing.half },
  cardTitle: { fontSize: 17, fontWeight: 600 },
});
