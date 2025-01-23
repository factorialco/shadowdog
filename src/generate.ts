import path from 'path'

import { CommandConfig, InvalidatorConfig, loadConfig, PluginsConfig } from './config'
import {
  filterCommandPlugins,
  filterEventListenerPlugins,
  filterMiddlewarePlugins,
} from './plugins'
import { TaskRunner } from './task-runner'
import { runTask } from './tasks'
import { logMessage } from './utils'
import { ShadowdogEventEmitter } from './events'

export type Task = ParallelTask | SerialTask | CommandTask | EmptyTask

export interface CommandTask {
  type: 'command'
  config: CommandConfig
  files: string[]
  invalidators: InvalidatorConfig
}

export interface ParallelTask {
  type: 'parallel'
  tasks: Task[]
}

interface SerialTask {
  type: 'serial'
  tasks: Task[]
}

export interface EmptyTask {
  type: 'empty'
}

const processTask = async (
  task: Task,
  pluginsConfig: PluginsConfig,
  eventEmitter: ShadowdogEventEmitter,
): Promise<unknown> => {
  switch (task.type) {
    case 'parallel': {
      return Promise.all(
        task.tasks.map((subTask) => processTask(subTask, pluginsConfig, eventEmitter)),
      )
    }
    case 'serial': {
      for (const subTask of task.tasks) {
        await processTask(subTask, pluginsConfig, eventEmitter)
      }
      return
    }
    case 'command': {
      eventEmitter.emit('begin', {
        artifacts: task.config.artifacts,
      })

      const taskRunner = new TaskRunner({
        files: task.files,
        invalidators: task.invalidators,
        config: task.config,
      })

      filterMiddlewarePlugins(pluginsConfig).forEach(({ fn, options }) => {
        taskRunner.use(fn.middleware, options)
      })

      taskRunner.use(() => {
        return runTask({
          command: task.config.command,
          workingDirectory: path.join(process.cwd(), task.config.workingDirectory),
        })
      })

      try {
        await taskRunner.execute()

        eventEmitter.emit('end', {
          artifacts: task.config.artifacts,
        })
      } catch (error) {
        eventEmitter.emit('error', {
          artifacts: task.config.artifacts,
          errorMessage: (error as Error).message,
        })
      }

      break
    }
    case 'empty': {
      // noop
    }
  }
}

export const generate = async (configFilePath: string) => {
  const config = loadConfig(configFilePath)
  const eventEmitter = new ShadowdogEventEmitter()

  filterEventListenerPlugins(config.plugins).forEach(({ fn, options }) => {
    fn.listener(eventEmitter, options ?? {})
  })

  eventEmitter.emit('initialized')

  let isShuttingDown = false
  const shutdown = async () => {
    if (isShuttingDown) return
    isShuttingDown = true

    try {
      logMessage('👋 Shutting down Shadowdog...')
      // emit exit event and wait for all listeners to complete
      await Promise.all(eventEmitter.listeners('exit').map((listener) => listener()))
      eventEmitter.removeAllListeners('exit')
      logMessage('✨ Shutdown complete')
      process.exit(0)
    } catch (error) {
      logMessage(`🚨 Error during shutdown: ${(error as Error).message}`)
      process.exit(1)
    }
  }

  process.on('beforeExit', shutdown)
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  const plugins = filterCommandPlugins(config.plugins)

  const task: Task = {
    type: 'parallel',
    tasks: config.watchers.flatMap((watcherConfig) =>
      watcherConfig.commands.map((commandConfig) => ({
        type: 'command',
        config: commandConfig,
        files: watcherConfig.files,
        invalidators: watcherConfig.invalidators,
      })),
    ),
  }

  const finalTask = plugins.reduce<Task>((subTask, { fn }) => fn.command(subTask), task)

  return processTask(finalTask, config.plugins, eventEmitter)
}
