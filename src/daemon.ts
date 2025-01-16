import * as childProcess from 'child_process'
import * as chokidar from 'chokidar'
import debounce from 'lodash/debounce'
import path from 'path'

import { ConfigFile, loadConfig } from './config'
import { runTask } from './tasks'
import { chalkFiles, logMessage, readShadowdogVersion } from './utils'
import chalk from 'chalk'

import { TaskRunner } from './task-runner'
import { filterEventListenerPlugins, filterMiddlewarePlugins } from './plugins'
import { ShadowdogEventEmitter } from './events'

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

          watcher.on('change', debounce(onFileChange, config.debounceTime))
          watcher.on('ready', onReady)
          watcher.on('error', reject)
        })
      }),
  )
}

export const runDaemon = async (configFilePath: string) => {
  const eventEmitter = new ShadowdogEventEmitter()

  let currentWatchers: chokidar.FSWatcher[] = []
  let currentConfig = loadConfig(configFilePath)

  filterEventListenerPlugins(currentConfig.plugins).forEach(({ fn, options }) => {
    fn.listener(eventEmitter, options ?? {})
  })

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

  await setupWatchers(currentConfig, eventEmitter)

  logMessage(`🚀 Shadowdog ${chalk.blue(readShadowdogVersion())} is ready to watch your files!`)

  eventEmitter.emit('initialized')

  process.on('exit', async () => {
    eventEmitter.emit('exit')
    // TODO: wait for listeners do die
  })
}
