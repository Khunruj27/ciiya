/**
 * Ciiya's palette, mirrored from the web app's `--ciiya-*` tokens
 * (src/app/globals.css in the repo root) so both surfaces read as one product.
 */

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#171717',
    textSecondary: '#747067',
    background: '#f8f6f1',
    backgroundElement: '#f0ece4',
    backgroundSelected: '#e8e4dc',
    surface: '#ffffff',
    line: '#e8e4dc',
    accent: '#c7a86b',
    accentDeep: '#7b6538',
    accentSoft: '#f3ead7',
    danger: '#b95757',
    onInk: '#ffffff',
  },
  dark: {
    text: '#f4f1ea',
    textSecondary: '#a8a297',
    background: '#111110',
    backgroundElement: '#1c1b19',
    backgroundSelected: '#2a2825',
    surface: '#1c1b19',
    line: '#2a2825',
    accent: '#c7a86b',
    accentDeep: '#dcc590',
    accentSoft: '#2e281b',
    danger: '#d98080',
    onInk: '#171717',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'system-ui, sans-serif',
    serif: 'Georgia, serif',
    rounded: 'system-ui, sans-serif',
    mono: 'ui-monospace, Menlo, monospace',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = {
  control: 14,
  card: 20,
  pill: 999,
} as const;

export const MaxContentWidth = 800;
