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

const setupWatchers = (config: ConfigFile, eventEmitter: ShadowdogEventEmitter) => {
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
          let tasks: Array<childProcess.ChildProcess> = []
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

          const killPendingTasks = () => {
            tasks.forEach((task) => {
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
            tasks = []
          }

          const onFileChange: (
            filePath: string,
            action: 'added' | 'changed' | 'deleted',
          ) => void = async (filePath, action) => {
            const changedFilePath = path.relative(process.cwd(), filePath)

            logMessage(
              `🔀 File '${chalk.blue(changedFilePath)}' has been ${chalk.cyanBright(action)}`,
            )

            killPendingTasks()

            await Promise.all(
              watcherConfig.commands.map(async (commandConfig) => {
                eventEmitter.emit('begin', {
                  artifacts: commandConfig.artifacts,
                })

                // Pre-process files with ignores
                const processedFiles = processFiles(watcherConfig.files, [
                  ...watcherConfig.ignored,
                  ...config.defaultIgnoredFiles,
                ])

                const taskRunner = new TaskRunner({
                  files: processedFiles,
                  environment: watcherConfig.environment,
                  config: commandConfig,
                  changedFilePath,
                  eventEmitter,
                })

                filterMiddlewarePlugins(config.plugins).forEach(({ fn, options }) => {
                  taskRunner.use(fn.middleware, options)
                })

                taskRunner.use(() => {
                  return runTask({
                    command: commandConfig.command,
                    workingDirectory: path.join(process.cwd(), commandConfig.workingDirectory),
                    changedFilePath,
                    onSpawn: (task) => {
                      tasks.push(task)
                    },
                    onExit: (task) => {
                      tasks = tasks.filter((pendingTask) => pendingTask.pid !== task.pid)
                    },
                  })
                })

                try {
                  await taskRunner.execute()

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
  let currentWatchers: chokidar.FSWatcher[] = await setupWatchers(currentConfig, eventEmitter)

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
        currentWatchers = await setupWatchers(currentConfig, eventEmitter)
        logMessage(`🐕 Shadowdog has been restarted successfully.`)
      } catch (error) {
        logMessage(`🚨 Error while restarting Shadowdog: ${(error as Error).message}`)
      }
    }, currentConfig.debounceTime),
  )

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
