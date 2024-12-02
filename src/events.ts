import { EventEmitter } from 'node:events'

type ShadowdogEvents = Record<
  'initialized' | 'exit' | 'begin' | 'end' | 'error' | 'changed',
  // TODO: review this
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any
>

export class ShadowdogEventEmitter extends EventEmitter<ShadowdogEvents> {}
