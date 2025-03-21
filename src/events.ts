import { EventEmitter } from 'node:events'
import { ArtifactConfig } from './config'

type ShadowdogEvents = {
  initialized: []
  exit: [number?]
  begin: [{ artifacts: ArtifactConfig[]; watcherIndex: number; commandIndex: number }]
  end: [
    {
      artifacts: ArtifactConfig[]
      watcherIndex: number
      commandIndex: number
      duration: number
      fromCache?: boolean
    },
  ]
  error: [
    {
      artifacts: ArtifactConfig[]
      errorMessage: string
      watcherIndex: number
      commandIndex: number
      duration: number
    },
  ]
  changed: [{ path: string; type: 'add' | 'change' | 'unlink' }]
}

export class ShadowdogEventEmitter extends EventEmitter {
  emit<K extends keyof ShadowdogEvents>(eventName: K, ...args: ShadowdogEvents[K]): boolean {
    return super.emit(eventName, ...args)
  }

  on<K extends keyof ShadowdogEvents>(
    eventName: K,
    listener: (...args: ShadowdogEvents[K]) => void,
  ): this {
    return super.on(eventName, listener)
  }

  once<K extends keyof ShadowdogEvents>(
    eventName: K,
    listener: (...args: ShadowdogEvents[K]) => void,
  ): this {
    return super.once(eventName, listener)
  }
}
