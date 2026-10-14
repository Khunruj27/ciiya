import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { HeaderButton, LoadingView, Segmented, StateView } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useQuery } from '@/hooks/use-query';
import { useTheme } from '@/hooks/use-theme';
import { data, type Album } from '@/lib/data';
import { selectAlbums, type AlbumSort } from '@/lib/data/album-list';
import { describeError, useLocale, useT } from '@/lib/i18n';

export default function AlbumsScreen() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const { data: albums, error, loading, refreshing, refresh } = useQuery(data.fetchAlbums);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<AlbumSort>('newest');
  const locale = useLocale();
  const visibleAlbums = useMemo(
    () => selectAlbums(albums ?? [], query, sort, locale),
    [albums, query, sort, locale]
  );
  const searching = query.trim().length > 0;
  const sortOptions: { value: AlbumSort; label: string }[] = [
    { value: 'newest', label: t.albums.sortNewest },
    { value: 'name', label: t.albums.sortName },
    { value: 'photos', label: t.albums.sortPhotos },
  ];

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
          data={visibleAlbums}
          keyExtractor={(album) => album.id}
          contentContainerStyle={styles.list}
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.accentDeep} />
          }
          ListHeaderComponent={
            <>
              {albums ? (
                <View style={styles.tools}>
                  <View style={[styles.search, { backgroundColor: theme.surface, borderColor: theme.line }]}>
                    <TextInput
                      value={query}
                      onChangeText={setQuery}
                      placeholder={t.albums.searchPlaceholder}
                      accessibilityLabel={t.albums.searchPlaceholder}
                      placeholderTextColor={theme.textSecondary}
                      style={[styles.searchInput, { color: theme.text }]}
                      inputMode="search"
                      returnKeyType="search"
                      autoCorrect={false}
                      autoCapitalize="none"
                      maxLength={200}
                    />
                    {query ? (
                      <Pressable
                        onPress={() => setQuery('')}
                        accessibilityRole="button"
                        accessibilityLabel={t.albums.clearSearch}
                        style={styles.clear}>
                        <ThemedText themeColor="textSecondary">×</ThemedText>
                      </Pressable>
                    ) : null}
                  </View>
                  <Segmented options={sortOptions} value={sort} onChange={setSort} />
                  <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">
                    {searching
                      ? t.albums.searchCount(visibleAlbums.length, albums.length)
                      : t.albums.albumCount(albums.length)}
                  </ThemedText>
                </View>
              ) : null}
              {error && albums?.length ? (
                <StateView
                  title={describeError(t, error)}
                  actionLabel={refreshing ? undefined : t.common.retry}
                  onAction={refresh}
                />
              ) : null}
            </>
          }
          ListEmptyComponent={
            error && !albums?.length ? (
              <StateView
                title={describeError(t, error)}
                actionLabel={t.common.retry}
                onAction={refresh}
              />
            ) : searching && albums?.length ? (
              <StateView
                title={t.albums.noResults}
                hint={t.albums.noResultsHint}
                actionLabel={t.albums.clearSearch}
                onAction={() => setQuery('')}
              />
            ) : (
              <StateView
                title={t.albums.empty}
                hint={t.albums.emptyHint}
                actionLabel={t.albums.newAlbum}
                onAction={() => router.push('/new-album')}
              />
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
  const title = album.title?.trim() || t.albums.untitled;

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/album/[id]', params: { id: album.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${t.albums.photoCount(album.photoCount)}${album.isPasswordProtected ? `, ${t.albums.locked}` : ''}`}
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
            recyclingKey={album.id}
          />
        ) : null}
      </View>
      <View style={styles.cardBody}>
        <ThemedText numberOfLines={1} style={styles.cardTitle}>
          {title}
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
  tools: { gap: Spacing.two, paddingBottom: Spacing.three },
  search: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: Radius.control },
  searchInput: { flex: 1, padding: Spacing.three, fontSize: 16, minHeight: 50 },
  clear: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  card: { borderWidth: 1, borderRadius: Radius.card, overflow: 'hidden' },
  cardPressed: { opacity: 0.85 },
  cover: { aspectRatio: 16 / 10, width: '100%' },
  cardBody: { padding: Spacing.three, gap: Spacing.half },
  cardTitle: { fontSize: 17, fontWeight: 600 },
});
