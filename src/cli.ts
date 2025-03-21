#!/usr/bin/env node
import { Command } from 'commander'
import { ShadowdogEventEmitter } from './events'
import { loadConfig } from './config'
import { generate } from './generate'
import { logMessage, setLogger } from './utils'
import { TerminalUI } from './ui/terminal-ui'
import { ArtifactTracker } from './ui/artifact-tracker'
import chalk from 'chalk'
import path from 'path'
import { runDaemon } from './daemon'

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'shadowdog.json')

const program = new Command()

program
  .name('shadowdog')
  .description('A tool for generating artifacts based on file changes')
  .version('0.0.1')
  .option('-c, --config <path>', 'path to config file', DEFAULT_CONFIG_PATH)
  .option('-w, --watch', 'watch for file changes')
  .option('-u, --ui', 'show terminal UI (only works with --watch)')

program.parse()

const options = program.opts()

async function main() {
  const shadowdogEventEmitter = new ShadowdogEventEmitter()
  const config = await loadConfig(options.config)

  if (options.watch) {
    let terminalUI: TerminalUI | undefined
    let artifactTracker: ArtifactTracker | undefined

    if (options.ui) {
      terminalUI = new TerminalUI()
      artifactTracker = new ArtifactTracker(config)

      // Set up UI logger
      setLogger({
        log: (message: string) => terminalUI?.log(message),
      })

      shadowdogEventEmitter.on('changed', ({ path: filePath, type }) => {
        logMessage(`📁 File ${chalk.blue(filePath)} ${type}d`)
      })

      shadowdogEventEmitter.on('begin', ({ artifacts, watcherIndex, commandIndex }) => {
        artifacts.forEach((artifact) => {
          artifactTracker?.updateArtifactStatus(
            watcherIndex,
            commandIndex,
            artifact.output,
            'generating',
          )
        })
        terminalUI?.updateArtifacts(artifactTracker?.getArtifacts() || [])
      })

      shadowdogEventEmitter.on(
        'end',
        ({ artifacts, watcherIndex, commandIndex, duration, fromCache }) => {
          artifacts.forEach((artifact) => {
            artifactTracker?.updateArtifactStatus(
              watcherIndex,
              commandIndex,
              artifact.output,
              'generated',
              fromCache,
            )
            artifactTracker?.updateArtifactDuration(
              watcherIndex,
              commandIndex,
              artifact.output,
              duration,
            )
          })
          terminalUI?.updateArtifacts(artifactTracker?.getArtifacts() || [])
        },
      )

      shadowdogEventEmitter.on(
        'error',
        ({ artifacts, errorMessage, watcherIndex, commandIndex, duration }) => {
          logMessage(`❌ Error: ${errorMessage}`)
          artifacts.forEach((artifact) => {
            artifactTracker?.updateArtifactStatus(
              watcherIndex,
              commandIndex,
              artifact.output,
              'error',
            )
            artifactTracker?.updateArtifactDuration(
              watcherIndex,
              commandIndex,
              artifact.output,
              duration,
            )
          })
          terminalUI?.updateArtifacts(artifactTracker?.getArtifacts() || [])
        },
      )

      terminalUI.start()

      // Display initial artifacts
      terminalUI.updateArtifacts(artifactTracker.getArtifacts())

      // Run initial generation
      try {
        await generate(config, shadowdogEventEmitter, {
          continueOnError: true,
        })
      } catch (error) {
        logMessage(`❌ Error: ${(error as Error).message}`)
      }
    }

    // Start watching for changes
    await runDaemon(config, options.config, shadowdogEventEmitter)
  } else {
    // Run once without watching
    await generate(config, shadowdogEventEmitter, {
      continueOnError: true,
    })
  }
}

main().catch((error) => {
  logMessage(`❌ Error: ${error.message}`)
  process.exit(1)
})
