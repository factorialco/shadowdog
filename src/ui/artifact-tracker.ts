import { ShadowdogConfig, Artifact } from '../types'

export class ArtifactTracker {
  private artifacts: Artifact[] = []

  constructor(private config: ShadowdogConfig) {
    this.initializeArtifacts()
  }

  private initializeArtifacts(): void {
    this.artifacts = this.config.watchers.flatMap((watcher, watcherIndex) =>
      watcher.commands.flatMap((command, commandIndex) =>
        command.artifacts.map(
          (artifact): Artifact => ({
            output: artifact.output,
            status: 'pending',
            watcherIndex,
            commandIndex,
            updatedAt: undefined,
            duration: undefined,
          }),
        ),
      ),
    )
  }

  public getArtifacts(): Artifact[] {
    return this.artifacts
  }

  public updateArtifactStatus(
    watcherIndex: number,
    commandIndex: number,
    artifactOutput: string,
    status: Artifact['status'],
    fromCache?: boolean,
  ): void {
    const artifact = this.artifacts.find(
      (a) =>
        a.watcherIndex === watcherIndex &&
        a.commandIndex === commandIndex &&
        a.output === artifactOutput,
    )

    if (artifact) {
      artifact.status = status
      if (status === 'generated') {
        artifact.updatedAt = Date.now()
      }
      if (fromCache !== undefined) {
        artifact.fromCache = fromCache
      }
    }
  }

  public updateArtifactDuration(
    watcherIndex: number,
    commandIndex: number,
    artifactOutput: string,
    duration: number,
  ): void {
    const artifact = this.artifacts.find(
      (a) =>
        a.watcherIndex === watcherIndex &&
        a.commandIndex === commandIndex &&
        a.output === artifactOutput,
    )

    if (artifact) {
      artifact.duration = duration
    }
  }

  public getArtifactByIndex(index: number): Artifact | undefined {
    return this.artifacts[index]
  }

  public getArtifactByOutput(output: string): Artifact | undefined {
    return this.artifacts.find((artifact) => artifact.output === output)
  }
}
