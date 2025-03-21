export interface Task {
  name: string
  status?: 'pending' | 'running' | 'success' | 'error'
  dependencies?: string[]
  plugin?: string
  options?: Record<string, unknown>
  startTime?: number
  endTime?: number
  error?: Error
}

export interface ShadowdogPlugin {
  name: string
}

export interface ArtifactConfig {
  output: string
}

export interface CommandConfig {
  command: string
  artifacts: ArtifactConfig[]
}

export interface WatcherConfig {
  files: string[]
  commands: CommandConfig[]
}

export interface ShadowdogConfig {
  plugins: ShadowdogPlugin[]
  watchers: WatcherConfig[]
}

export interface Artifact {
  output: string
  status: 'pending' | 'generating' | 'generated' | 'error'
  watcherIndex: number
  commandIndex: number
  updatedAt?: number
  duration?: number
  config?: ArtifactConfig
  fromCache?: boolean
}

export interface Logger {
  log(message: string): void
}

export interface GenerateOptions {
  continueOnError: boolean
  logger?: Logger
}
