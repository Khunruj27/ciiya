'use client'

import { createContext, useContext, useMemo } from 'react'
import {
  DEFAULT_LOCALE,
  getDictionary,
  type Dictionary,
  type Locale,
} from '@/lib/i18n'

type I18nValue = { locale: Locale; t: Dictionary }

const I18nContext = createContext<I18nValue>({
  locale: DEFAULT_LOCALE,
  t: getDictionary(DEFAULT_LOCALE),
})

/**
 * Seeds client components with the server-resolved locale so `useI18n()` reads
 * the same language the server rendered — no hydration mismatch, no flash.
 */
export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale
  children: React.ReactNode
}) {
  const value = useMemo<I18nValue>(
    () => ({ locale, t: getDictionary(locale) }),
    [locale]
  )
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  return useContext(I18nContext)
}
