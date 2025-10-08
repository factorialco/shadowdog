import * as childProcess from 'child_process'
import * as chokidar from 'chokidar'
import debounce from 'lodash/debounce'
import path from 'path'

import chalk from 'chalk'
import { ConfigFile, loadConfig } from './config'
import { runTask } from './tasks'
import { chalkFiles, exit, logMessage, processFiles, readShadowdogVersion } from './utils'

import { ShadowdogEventEmitter } from './events'
import { filterMiddlewarePlugins } from './plugins'
import { TaskRunner } from './task-runner'

// Helper function to find command configuration for a specific artifact
const findCommandForArtifact = (
  config: ConfigFile,
  artifactOutput: string,
): {
  commandConfig: {
    command: string
    workingDirectory: string
    files: string[]
    environment: string[]
  }
  watcherConfig: {
    files: string[]
    environment: string[]
    ignored: string[]
  }
} | null => {
  for (const watcher of config.watchers) {
    for (const cmdConfig of watcher.commands) {
      for (const artifact of cmdConfig.artifacts) {
        if (artifact.output === artifactOutput) {
          return {
            commandConfig: {
              command: cmdConfig.command,
              workingDirectory: cmdConfig.workingDirectory,
              files: watcher.files,
              environment: watcher.environment,
            },
            watcherConfig: {
              files: watcher.files,
              environment: watcher.environment,
              ignored: watcher.ignored,
            },
          }
        }
      }
    }
  }
  return null
}

// Helper function to execute a task with common setup
const executeTask = async (
  config: ConfigFile,
  commandConfig: {
    command: string
    workingDirectory: string
    files: string[]
    environment: string[]
  },
  watcherConfig: {
    files: string[]
    environment: string[]
    ignored: string[]
  },
  eventEmitter: ShadowdogEventEmitter,
  options: {
    changedFilePath?: string
    artifacts: Array<{ output: string }>
    onSpawn?: (task: childProcess.ChildProcess) => void
    onExit?: (task: childProcess.ChildProcess) => void
  },
): Promise<void> => {
  // Pre-process files with ignores
  const processedFiles = processFiles(watcherConfig.files, [
    ...watcherConfig.ignored,
    ...config.defaultIgnoredFiles,
  ])

  const taskRunner = new TaskRunner({
    files: processedFiles,
    environment: watcherConfig.environment,
    config: {
      command: commandConfig.command,
      workingDirectory: commandConfig.workingDirectory,
      tags: [],
      artifacts: options.artifacts,
    },
    changedFilePath: options.changedFilePath,
    eventEmitter,
  })

  filterMiddlewarePlugins(config.plugins).forEach(({ fn, options: pluginOptions }) => {
    taskRunner.use(fn.middleware, pluginOptions)
  })

  taskRunner.use(() => {
    return runTask({
      command: commandConfig.command,
      workingDirectory: path.join(process.cwd(), commandConfig.workingDirectory),
      changedFilePath: options.changedFilePath,
      onSpawn: options.onSpawn || (() => {}),
      onExit: options.onExit || (() => {}),
    })
  })

  await taskRunner.execute()
}

const setupWatchers = (
  config: ConfigFile,
  eventEmitter: ShadowdogEventEmitter,
  getIsPaused: () => boolean,
  pendingTasks: Array<childProcess.ChildProcess>,
  killPendingTasks: () => void,
) => {
  return Promise.all<chokidar.FSWatcher>(
    config.watchers
      .filter(({ files, enabled = true }) => {
        if (!enabled) {
          logMessage(`🧪 Watcher for files '${chalkFiles(files)}' is disabled. Skipping...`)
        }
        return enabled
      })
      .map((watcherConfig) => {
        return new Promise((resolve, reject) => {
          const ignored = [...watcherConfig.ignored, ...config.defaultIgnoredFiles].map((file) =>
            path.join(process.cwd(), file),
          )
          const watcher = chokidar.watch(
            watcherConfig.files.map((file) => path.join(process.cwd(), file)),
            {
              ignoreInitial: true,
              ignored,
            },
          )

          const onFileChange: (
            filePath: string,
            action: 'added' | 'changed' | 'deleted',
          ) => void = async (filePath, action) => {
            const changedFilePath = path.relative(process.cwd(), filePath)

            logMessage(
              `🔀 File '${chalk.blue(changedFilePath)}' has been ${chalk.cyanBright(action)}`,
            )

            // Check if shadowdog is paused
            if (getIsPaused()) {
              logMessage(
                `⏸️  ${chalk.yellow('File change ignored due to pause:')} ${changedFilePath}`,
              )
              return
            }

            killPendingTasks()

            await Promise.all(
              watcherConfig.commands.map(async (commandConfig) => {
                eventEmitter.emit('begin', {
                  artifacts: commandConfig.artifacts,
                })

                try {
                  await executeTask(
                    config,
                    {
                      command: commandConfig.command,
                      workingDirectory: commandConfig.workingDirectory,
                      files: watcherConfig.files,
                      environment: watcherConfig.environment,
                    },
                    watcherConfig,
                    eventEmitter,
                    {
                      changedFilePath,
                      artifacts: commandConfig.artifacts,
                      onSpawn: (task) => {
                        pendingTasks.push(task)
                      },
                      onExit: (task) => {
                        pendingTasks.splice(
                          pendingTasks.findIndex((pendingTask) => pendingTask.pid === task.pid),
                          1,
                        )
                      },
                    },
                  )

                  eventEmitter.emit('end', {
                    artifacts: commandConfig.artifacts,
                  })
                } catch (error) {
                  eventEmitter.emit('error', {
                    artifacts: commandConfig.artifacts,
                    errorMessage: (error as Error).message,
                  })
                }
              }),
            )
          }

          const onReady = () => {
            logMessage(
              `🔍 Files ${chalkFiles(watcherConfig.files)} are watching ${chalk.cyan(
                Object.keys(watcher.getWatched()).length,
              )} folders.`,
            )

            resolve(watcher)
          }

          watcher.on(
            'add',
            debounce((filePath) => onFileChange(filePath, 'added'), config.debounceTime),
          )
          watcher.on(
            'change',
            debounce((filePath) => onFileChange(filePath, 'changed'), config.debounceTime),
          )
          watcher.on(
            'unlink',
            debounce((filePath) => onFileChange(filePath, 'deleted'), config.debounceTime),
          )
          watcher.on('ready', onReady)
          watcher.on('error', reject)
        })
      }),
  )
}

export const runDaemon = async (
  config: ConfigFile,
  configFilePath: string,
  eventEmitter: ShadowdogEventEmitter,
) => {
  let currentConfig = config
  let isPaused = false
  let pendingTasks: Array<childProcess.ChildProcess> = []

  const killPendingTasks = () => {
    pendingTasks.forEach((task) => {
      try {
        if (task.pid) {
          process.kill(-task.pid, 'SIGKILL')
          logMessage(
            `💀 Command (PID: ${chalk.magenta(
              task.pid,
            )}) was killed because another task was started`,
          )
        }
      } catch {
        logMessage(`💀 Command (PID: ${chalk.magenta(task.pid)}) Unable to kill process.`)
      }
    })
    pendingTasks = []
  }

  let currentWatchers: chokidar.FSWatcher[] = await setupWatchers(
    currentConfig,
    eventEmitter,
    () => isPaused,
    pendingTasks,
    killPendingTasks,
  )

  const configWatcher = chokidar.watch(configFilePath, {
    ignoreInitial: true,
  })

  configWatcher.on(
    'change',
    debounce(async () => {
      logMessage(`🔃 Configuration file has been changed. Restarting Shadowdog...`)
      try {
        currentConfig = loadConfig(configFilePath)
        // Emit config loaded event for plugins that need to update
        eventEmitter.emit('configLoaded', { config: currentConfig })
        await Promise.all(currentWatchers.map((watcher) => watcher.close()))
        currentWatchers = await setupWatchers(
          currentConfig,
          eventEmitter,
          () => isPaused,
          pendingTasks,
          killPendingTasks,
        )
        logMessage(`🐕 Shadowdog has been restarted successfully.`)
      } catch (error) {
        logMessage(`🚨 Error while restarting Shadowdog: ${(error as Error).message}`)
      }
    }, currentConfig.debounceTime),
  )

  // Handle pause/resume events
  eventEmitter.on('pause', () => {
    isPaused = true
    logMessage(`⏸️  ${chalk.yellow('Shadowdog has been paused via MCP')}`)
  })

  eventEmitter.on('resume', () => {
    isPaused = false
    logMessage(`▶️  ${chalk.green('Shadowdog has been resumed via MCP')}`)
  })

  // Handle artifact computation requests
  eventEmitter.on('computeArtifact', async ({ artifactOutput }) => {
    if (isPaused) {
      logMessage(
        `⏸️  ${chalk.yellow('Artifact computation skipped due to pause:')} ${artifactOutput}`,
      )
      return
    }

    logMessage(`🔨 ${chalk.blue('Computing artifact via MCP:')} ${chalk.cyan(artifactOutput)}`)

    // Kill any pending tasks before starting new computation
    killPendingTasks()

    // Find the command configuration for this artifact
    const commandInfo = findCommandForArtifact(currentConfig, artifactOutput)

    if (!commandInfo) {
      logMessage(`❌ ${chalk.red('No command found for artifact:')} ${artifactOutput}`)
      return
    }

    try {
      await executeTask(
        currentConfig,
        commandInfo.commandConfig,
        commandInfo.watcherConfig,
        eventEmitter,
        {
          artifacts: [{ output: artifactOutput }],
          onSpawn: () => {}, // No need to track for MCP requests
          onExit: () => {}, // No need to track for MCP requests
        },
      )

      logMessage(`✅ ${chalk.green('Artifact computed successfully:')} ${artifactOutput}`)
    } catch (error) {
      logMessage(`❌ ${chalk.red('Failed to compute artifact:')} ${(error as Error).message}`)
    }
  })

  logMessage(`🚀 Shadowdog ${chalk.blue(readShadowdogVersion())} is ready to watch your files!`)

  eventEmitter.emit('initialized')

  let isShuttingDown = false
  const shutdown = async () => {
    if (isShuttingDown) return
    isShuttingDown = true
    return exit(eventEmitter, 0)
  }

  process.on('beforeExit', shutdown)
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
