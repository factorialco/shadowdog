import fs from 'fs-extra'
import { logMessage } from './utils'
import { z } from 'zod'
import chalk from 'chalk'
import { pluginOptionsSchema } from './pluginTypes'

export const configSchema = z
  .object({
    $schema: z.string().optional(),
    debounceTime: z
      .number()
      .min(0)
      .optional()
      .default(2000)
      .describe('The time in milliseconds to wait before running the command after a file change.'),
    defaultIgnoredFiles: z
      .array(z.string().describe('File path or glob'))
      .optional()
      .default(['.git', '**/node_modules'])
      .describe('Default ignored files when watching files'),
    plugins: z.array(pluginOptionsSchema).optional().default([]).describe('List of plugins to use'),
    watchers: z
      .array(
        z
          .object({
            enabled: z
              .boolean()
              .optional()
              .default(true)
              .describe('Whether the watcher is enabled or not'),
            files: z
              .array(z.string().describe('File path'))
              .default([])
              .describe('List of files to watch'),
            invalidators: z
              .object({
                files: z
                  .array(z.string().describe('File path'))
                  .default([])
                  .describe(
                    'List of files that invalidate the cache when they change. These ones are not watched.',
                  ),
                environment: z
                  .array(z.string().describe('Environment variable name'))
                  .default([])
                  .describe(
                    'List of environment variables that invalidate the cache when they change.',
                  ),
              })
              .default({ files: [], environment: [] })
              .describe('List of invalidators for the cache'),
            ignored: z
              .array(z.string().describe('File path'))
              .default([])
              .describe('List of files to ignore when they change'),
            label: z.string().optional(),
            commands: z
              .array(
                z
                  .object({
                    command: z.string().describe('The command to run when a file changes'),
                    workingDirectory: z
                      .string()
                      .default('')
                      .describe('The directory where the command should run.'),
                    tags: z
                      .array(z.string())
                      .default([])
                      .describe(
                        'A list of tags to associate with the command. Used with the `generate` command to filter commands by tag.',
                      ),
                    artifacts: z
                      .array(
                        z
                          .object({
                            output: z.string().describe('Path to the output file or folder'),
                            description: z
                              .string()
                              .optional()
                              .describe('A description of the artifact'),
                            ignore: z
                              .array(z.string())
                              .optional()
                              .describe(
                                'A list of files to ignore before saving the folder artifacts',
                              ),
                          })
                          .strict()
                          .describe('An artifact produced by the command'),
                      )
                      .default([])
                      .describe('List of artifacts produced by the command'),
                  })
                  .strict()
                  .describe('Command configuration when a file changes'),
              )
              .describe('List of commands to run when a file changes'),
          })
          .strict()
          .describe('Watcher configuration'),
      )
      .describe('List of watchers to run'),
  })
  .strict()

export type ConfigFile = z.infer<typeof configSchema>

export type WatcherConfig = ConfigFile['watchers'][number]

export type CommandConfig = WatcherConfig['commands'][number]

export type ArtifactConfig = NonNullable<CommandConfig['artifacts']>[number]

export type PluginsConfig = ConfigFile['plugins']

export type InvalidatorConfig = WatcherConfig['invalidators']

export const loadConfig = (configFilePath: string): ConfigFile => {
  logMessage(`✨ Reading config file from '${chalk.blue(configFilePath)}'...`)

  return configSchema.parse(JSON.parse(fs.readFileSync(configFilePath, 'utf-8')))
}
