import Stripe from 'stripe'
import { getStripeRuntimeConfig } from '@/lib/stripe-config'

export const stripeConfig = getStripeRuntimeConfig()
export const stripe = new Stripe(stripeConfig.secretKey)
