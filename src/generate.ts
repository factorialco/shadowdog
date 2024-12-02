import path from 'path'

import { CommandConfig, InvalidatorConfig, loadConfig, PluginsConfig } from './config'
import { filterCommandPlugins, filterMiddlewarePlugins } from './plugins'
import { TaskRunner } from './task-runner'
import { runTask } from './tasks'

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

const processTask = async (task: Task, pluginsConfig: PluginsConfig): Promise<unknown> => {
  switch (task.type) {
    case 'parallel': {
      return Promise.all(task.tasks.map((subTask) => processTask(subTask, pluginsConfig)))
    }
    case 'serial': {
      for (const subTask of task.tasks) {
        await processTask(subTask, pluginsConfig)
      }
      return
    }
    case 'command': {
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

      return taskRunner.execute()
    }
    case 'empty': {
      // noop
    }
  }
}

export const generate = async (configFilePath: string) => {
  const config = loadConfig(configFilePath)
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

  return processTask(finalTask, config.plugins)
}
