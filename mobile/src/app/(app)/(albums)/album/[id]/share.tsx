import { useLocalSearchParams } from 'expo-router';

import { AlbumDeliveryPanel } from '@/components/album-delivery-panel';
import { useSession } from '@/ctx/session';

export default function AlbumShareScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useSession();
  return <AlbumDeliveryPanel key={`${user?.id ?? ''}:${id}`} albumId={id} accountId={user?.id ?? ''} />;
}
