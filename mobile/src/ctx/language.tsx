import { useLocales } from 'expo-localization';
import * as SecureStore from 'expo-secure-store';
import { createContext, useContext, useEffect, useSyncExternalStore, type PropsWithChildren } from 'react';
import { Platform } from 'react-native';

import { createLanguagePreferenceStore, resolveLocale, type LanguagePreference, type Locale } from '@/lib/language-preference';

const KEY = 'ciiya.language.v1';
const languageStore = createLanguagePreferenceStore({
  read: async () => Platform.OS === 'web'
    ? globalThis.localStorage?.getItem(KEY) ?? null
    : SecureStore.getItemAsync(KEY),
  write: async value => {
    if (Platform.OS === 'web') globalThis.localStorage.setItem(KEY, value);
    else await SecureStore.setItemAsync(KEY, value);
  },
});

type LanguageValue = {
  locale: Locale;
  preference: LanguagePreference;
  saving: boolean;
  saveFailed: boolean;
  selectLanguage: (preference: LanguagePreference) => Promise<void>;
};
const LanguageContext = createContext<LanguageValue | null>(null);

export function LanguageProvider({ children }: PropsWithChildren) {
  const locales = useLocales();
  const snapshot = useSyncExternalStore(languageStore.subscribe, languageStore.getSnapshot, languageStore.getSnapshot);
  const locale = resolveLocale(snapshot.preference, locales[0]?.languageCode);
  useEffect(() => { void languageStore.restore(); }, []);
  return (
    <LanguageContext value={{ ...snapshot, locale, selectLanguage: languageStore.select }}>
      {children}
    </LanguageContext>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
