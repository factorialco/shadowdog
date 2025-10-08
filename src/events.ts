import { EventEmitter } from 'node:events'
import { ArtifactConfig } from './config'

type ShadowdogEvents = {
  initialized: []
  exit: [number?]
  begin: [{ artifacts: ArtifactConfig[] }]
  end: [{ artifacts: ArtifactConfig[] }]
  error: [{ artifacts: ArtifactConfig[]; errorMessage: string }]
  changed: [{ path: string; type: 'add' | 'change' | 'unlink' }]
  configLoaded: [{ config: unknown }]
  allTasksComplete: []
  generateStarted: []
  pause: []
  resume: []
  computeArtifact: [{ artifactOutput: string }]
  computeAllArtifacts: [{ artifacts: ArtifactConfig[] }]
}

export class ShadowdogEventEmitter extends EventEmitter<ShadowdogEvents> {}
