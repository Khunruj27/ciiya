export const PLAN_LIMITS = {
  free: {
    name: 'Free',
    storageBytes: 5 * 1024 * 1024 * 1024,
  },

  starter: {
    name: 'Starter',
    storageBytes: 20 * 1024 * 1024 * 1024,
  },

  pro: {
    name: 'Pro',
    storageBytes: 50 * 1024 * 1024 * 1024,
  },

  business: {
    name: 'Business',
    storageBytes: 100 * 1024 * 1024 * 1024,
  },
} as const

export type PlanKey = keyof typeof PLAN_LIMITS