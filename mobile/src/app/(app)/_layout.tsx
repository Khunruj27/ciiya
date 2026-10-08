import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';

export default function AppLayout() {
  const t = useT();
  const theme = useTheme();

  return (
    <NativeTabs tintColor={theme.accentDeep}>
      <NativeTabs.Trigger name="(albums)">
        <NativeTabs.Trigger.Label>{t.tabs.albums}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'photo.on.rectangle', selected: 'photo.fill.on.rectangle.fill' }}
          md="photo_library"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="account">
        <NativeTabs.Trigger.Label>{t.tabs.account}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }}
          md="account_circle"
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
