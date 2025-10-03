import path from 'path'
import fs from 'fs'

import { CommandConfig, ConfigFile, PluginsConfig } from './config'
import { ShadowdogEventEmitter } from './events'
import { filterCommandPlugins, filterMiddlewarePlugins } from './plugins'
import { TaskRunner } from './task-runner'
import { runTask } from './tasks'
import { processFiles } from './utils'

export type Task = ParallelTask | SerialTask | CommandTask | EmptyTask

export interface CommandTask {
  type: 'command'
  config: CommandConfig
  files: string[]
  environment: string[]
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

interface GenerateOptions {
  continueOnError: boolean
}

// Wait for artifact files to be written and readable
const waitForArtifacts = async (artifacts: CommandConfig['artifacts']): Promise<void> => {
  // Make max retries configurable via environment variable for faster CI tests
  const maxRetries = process.env.SHADOWDOG_ARTIFACT_WAIT_MAX_RETRIES
    ? parseInt(process.env.SHADOWDOG_ARTIFACT_WAIT_MAX_RETRIES, 10)
    : 50 // Default: 5 seconds max wait time
  const retryDelay = 100 // 100ms between retries

  for (const artifact of artifacts) {
    const artifactPath = path.join(process.cwd(), artifact.output)
    let retries = 0

    while (retries < maxRetries) {
      try {
        // Check if file exists and is readable
        await fs.promises.access(artifactPath, fs.constants.F_OK | fs.constants.R_OK)

        // For files, also verify they have content (not empty)
        const stats = await fs.promises.stat(artifactPath)
        if (stats.isFile() && stats.size === 0) {
          throw new Error('File is empty')
        }

        // File exists and is readable with content, move to next artifact
        break
      } catch {
        // File doesn't exist or isn't readable yet, wait and retry
        await new Promise((resolve) => setTimeout(resolve, retryDelay))
        retries++
      }
    }

    if (retries >= maxRetries) {
      // Fail the build if artifact is not available after max retries
      // This ensures we catch cases where commands don't produce expected outputs
      throw new Error(
        `Artifact '${artifact.output}' was not created or is not readable after task completion. ` +
          `Waited ${(maxRetries * retryDelay) / 1000} seconds.`,
      )
    }
  }
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
      eventEmitter.emit('begin', {
        artifacts: task.config.artifacts,
      })

      const taskRunner = new TaskRunner({
        files: task.files,
        environment: task.environment,
        config: task.config,
        eventEmitter,
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

        // Wait for all artifacts to be written and readable before proceeding
        // This ensures dependent tasks can read the updated artifact files
        await waitForArtifacts(task.config.artifacts)

        eventEmitter.emit('end', {
          artifacts: task.config.artifacts,
        })
      } catch (error) {
        eventEmitter.emit('error', {
          artifacts: task.config.artifacts,
          errorMessage: (error as Error).message,
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
    tasks: config.watchers.flatMap((watcherConfig) => {
      const files = processFiles(
        watcherConfig.files,
        [...watcherConfig.ignored, ...config.defaultIgnoredFiles],
        true,
      ) // Enable preserveNonExistent for dependency tracking

      return watcherConfig.commands.map((commandConfig) => ({
        type: 'command',
        config: commandConfig,
        files,
        environment: watcherConfig.environment,
      }))
    }),
  }

  const finalTask = plugins.reduce<Task>((subTask, { fn }) => fn.command(subTask), task)

  return processTask(finalTask, config.plugins, eventEmitter, options)
}
