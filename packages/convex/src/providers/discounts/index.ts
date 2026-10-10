import { providersMode } from '../../lib/env'
import { mockDiscounts } from './mock'
import { polarDiscounts } from './polar'
import type { DiscountsProvider } from './types'

export function discountsProvider(): DiscountsProvider {
  return providersMode() === 'real' ? polarDiscounts : mockDiscounts
}
