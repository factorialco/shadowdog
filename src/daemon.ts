import * as childProcess from 'child_process'
import * as chokidar from 'chokidar'
import debounce from 'lodash/debounce'
import path from 'path'

import chalk from 'chalk'
import { ConfigFile, loadConfig } from './config'
import { runTask } from './tasks'
import { chalkFiles, exit, logMessage, readShadowdogVersion } from './utils'

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

          const onFileChange: (filePath: string) => void = async (filePath) => {
            const changedFilePath = path.relative(process.cwd(), filePath)

            logMessage(`🔀 File '${chalk.blue(changedFilePath)}' has been changed`)

            killPendingTasks()

            await Promise.all(
              watcherConfig.commands.map(async (commandConfig) => {
                eventEmitter.emit('begin', {
                  artifacts: commandConfig.artifacts,
                })

                const taskRunner = new TaskRunner({
                  files: watcherConfig.files,
                  invalidators: watcherConfig.invalidators,
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

          const debouncedOnFileChange = debounce(onFileChange, config.debounceTime)

          watcher.on('add', debouncedOnFileChange)
          watcher.on('change', debouncedOnFileChange)
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
