import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Field } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { data } from '@/lib/data';
import { describeError, useT } from '@/lib/i18n';

export default function NewAlbumScreen() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleCreate() {
    if (saving) return;

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError(t.newAlbum.nameRequired);
      return;
    }

    setSaving(true);
    setError('');

    try {
      await data.createAlbum({ title: trimmedTitle, description: description.trim() });
      // The albums list reloads when it regains focus and shows the new album.
      router.back();
    } catch (createError) {
      setError(describeError(t, createError));
      setSaving(false);
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerLeft: () => (
            <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12}>
              <ThemedText>{t.common.cancel}</ThemedText>
            </Pressable>
          ),
        }}
      />

      <KeyboardAvoidingView
        style={[styles.flex, { backgroundColor: theme.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled">
          <Field
            label={t.newAlbum.nameLabel}
            value={title}
            onChangeText={setTitle}
            placeholder={t.newAlbum.namePlaceholder}
            autoFocus
            maxLength={120}
            returnKeyType="next"
          />
          <Field
            label={t.newAlbum.descriptionLabel}
            value={description}
            onChangeText={setDescription}
            placeholder={t.newAlbum.descriptionPlaceholder}
            multiline
            maxLength={500}
          />

          {error ? (
            <ThemedText type="small" accessibilityRole="alert" style={{ color: theme.danger }}>
              {error}
            </ThemedText>
          ) : null}

          <Button
            label={saving ? t.newAlbum.creating : t.newAlbum.create}
            onPress={handleCreate}
            loading={saving}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three },
});
