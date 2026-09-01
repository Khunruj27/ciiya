import { cookies } from 'next/headers'
import {
  LOCALE_COOKIE,
  normalizeLocale,
  getDictionary,
  type Locale,
  type Dictionary,
} from './i18n'

/**
 * Server-side locale read. Use in server components / route handlers to render
 * in the visitor's chosen language on first paint.
 */
export async function getLocale(): Promise<Locale> {
  const store = await cookies()
  return normalizeLocale(store.get(LOCALE_COOKIE)?.value)
}

export async function getServerDictionary(): Promise<{
  locale: Locale
  t: Dictionary
}> {
  const locale = await getLocale()
  return { locale, t: getDictionary(locale) }
}
