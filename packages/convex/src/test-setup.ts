import { convexTest } from 'convex-test'
import schema from './schema'

/** Every Convex module, so `convexTest` can resolve scheduled functions and internal calls. */
export const modules = import.meta.glob('./**/*.ts')

export function setup() {
  return convexTest(schema, modules)
}
