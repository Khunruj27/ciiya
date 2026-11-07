import { isDemoMode } from '@/lib/config';

import { demoData } from './demo';
import { liveData } from './live';
import type { DataSource } from './types';

export * from './types';

/** Everything screens read or write goes through this one object. */
export const data: DataSource = isDemoMode ? demoData : liveData;
