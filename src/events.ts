import { EventEmitter } from 'node:events'
import { ArtifactConfig } from './config'

type ShadowdogEvents = {
  initialized: []
  exit: [number?]
  begin: [{ artifacts: ArtifactConfig[] }]
  end: [{ artifacts: ArtifactConfig[] }]
  error: [{ artifacts: ArtifactConfig[]; errorMessage: string }]
  changed: [{ path: string; type: 'add' | 'change' | 'unlink' }]
}

export class ShadowdogEventEmitter extends EventEmitter<ShadowdogEvents> {}
