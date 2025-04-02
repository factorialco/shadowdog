import path from 'path'

import { CommandConfig, ConfigFile, InvalidatorConfig, PluginsConfig } from './config'
import { ShadowdogEventEmitter } from './events'
import { filterCommandPlugins, filterMiddlewarePlugins } from './plugins'
import { TaskRunner } from './task-runner'
import { runTask } from './tasks'

export type Task = ParallelTask | SerialTask | CommandTask | EmptyTask

export interface ParallelTask {
  type: 'parallel'
  tasks: Task[]
}

export interface SerialTask {
  type: 'serial'
  tasks: Task[]
}

export interface CommandTask {
  type: 'command'
  config: CommandConfig
  files: string[]
  invalidators: InvalidatorConfig
  watcherIndex: number
  commandIndex: number
}

export interface EmptyTask {
  type: 'empty'
}

export interface GenerateOptions {
  continueOnError: boolean
}

const processTask = async (
  task: Task,
  pluginsConfig: PluginsConfig,
  eventEmitter: ShadowdogEventEmitter,
  options: GenerateOptions,
): Promise<unknown> => {
  switch (task.type) {
    case 'parallel': {
      return Promise.all(
        task.tasks.map((subTask) => processTask(subTask, pluginsConfig, eventEmitter, options)),
      )
    }
    case 'serial': {
      for (const subTask of task.tasks) {
        await processTask(subTask, pluginsConfig, eventEmitter, options)
      }
      return
    }
    case 'command': {
      const startTime = Date.now()

      eventEmitter.emit('begin', {
        artifacts: task.config.artifacts,
        watcherIndex: task.watcherIndex,
        commandIndex: task.commandIndex,
      })

      const taskRunner = new TaskRunner({
        files: task.files,
        invalidators: task.invalidators,
        config: task.config,
        eventEmitter,
        task,
      })

      filterMiddlewarePlugins(pluginsConfig).forEach(({ fn, options: pluginOptions }) => {
        taskRunner.use(fn.middleware, pluginOptions)
      })

      taskRunner.use(() => {
        return runTask({
          command: task.config.command,
          workingDirectory: path.join(process.cwd(), task.config.workingDirectory),
          onSpawn: () => {},
          onExit: () => {},
        })
      })

      try {
        await taskRunner.execute()
        const duration = Date.now() - startTime

        eventEmitter.emit('end', {
          artifacts: task.config.artifacts,
          watcherIndex: task.watcherIndex,
          commandIndex: task.commandIndex,
          duration,
        })
      } catch (error) {
        const duration = Date.now() - startTime

        eventEmitter.emit('error', {
          artifacts: task.config.artifacts,
          errorMessage: (error as Error).message,
          watcherIndex: task.watcherIndex,
          commandIndex: task.commandIndex,
          duration,
        })

        if (!options.continueOnError) {
          throw error
        }
      }

      break
    }
    case 'empty': {
      // noop
    }
  }
}

export const generate = async (
  config: ConfigFile,
  eventEmitter: ShadowdogEventEmitter,
  options: GenerateOptions,
) => {
  const plugins = filterCommandPlugins(config.plugins)

  const task: Task = {
    type: 'parallel',
    tasks: config.watchers.flatMap((watcherConfig, watcherIndex) =>
      watcherConfig.commands.map((commandConfig, commandIndex) => ({
        type: 'command',
        config: commandConfig,
        files: watcherConfig.files,
        invalidators: watcherConfig.invalidators,
        watcherIndex,
        commandIndex,
      })),
    ),
  }

  const finalTask = plugins.reduce<Task>((subTask, { fn }) => fn.command(subTask), task)

  return processTask(finalTask, config.plugins, eventEmitter, options)
}
