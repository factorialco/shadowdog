import { TerminalUI } from './terminal-ui'
import { ArtifactTracker } from './artifact-tracker'
import { Artifact, ShadowdogConfig } from '../types'

export async function startUI(config: ShadowdogConfig): Promise<void> {
  const ui = new TerminalUI()
  const tracker = new ArtifactTracker(config)

  try {
    ui.updateArtifacts(tracker.getArtifacts())

    // Handle generate command
    ui.on('generate', (artifact: Artifact) => {
      // Update status to generating
      tracker.updateArtifactStatus(
        artifact.watcherIndex,
        artifact.commandIndex,
        artifact.output,
        'generating',
      )
      ui.updateArtifacts(tracker.getArtifacts())
      ui.log(`Generating artifact: ${artifact.output}`)

      // Simulate generation (this should be replaced with actual command execution)
      setTimeout(() => {
        tracker.updateArtifactStatus(
          artifact.watcherIndex,
          artifact.commandIndex,
          artifact.output,
          'generated',
        )
        ui.updateArtifacts(tracker.getArtifacts())
        ui.log(`Generated artifact: ${artifact.output}`)
      }, 2000)
    })

    // Handle quit event
    ui.on('quit', () => {
      process.exit(0)
    })

    // Start the UI
    ui.start()
  } catch (error) {
    console.error('Failed to start UI:', error)
    process.exit(1)
  }
}
