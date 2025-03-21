import { z } from 'zod'

import { CommandConfig, InvalidatorConfig, PluginsConfig } from '../config'
import { Task } from '../generate'
import { pluginOptionsSchema } from '../pluginTypes'

import shadowdogLocalCache from './shadowdog-local-cache'
import shadowdogRake from './shadowdog-rake'
import shadowdogTag from './shadowdog-tag'
import shadowdogRemoteAwsS3Cache from './shadowdog-remote-aws-s3-cache'
import shadowdogTree from './shadowdog-tree'
import shadowdogSocket from './shadowdog-socket'
import shadowdogGit from './shadowdog-git'
import shadowdogLock from './shadowdog-lock'

import { ShadowdogEventEmitter } from '../events'

export type Middleware<Options = unknown> = (options: {
  files: string[]
  invalidators: InvalidatorConfig
  config: CommandConfig
  eventEmitter: ShadowdogEventEmitter
  changedFilePath?: string
  options: Options
  next: () => Promise<unknown>
  abort: () => void
  task?: Task
}) => Promise<unknown>

export type Listener<Options = unknown> = (
  shadowdogEventListener: ShadowdogEventEmitter,
  options: Options,
) => void

export type Command = (activeWatchers: Task) => Task

type PluginsMap = {
  'shadowdog-rake': { command: Command }
  'shadowdog-local-cache': {
    middleware: Middleware<
      Extract<z.infer<typeof pluginOptionsSchema>, { name: 'shadowdog-local-cache' }>['options']
    >
  }
  'shadowdog-remote-aws-s3-cache': {
    middleware: Middleware<
      Extract<
        z.infer<typeof pluginOptionsSchema>,
        { name: 'shadowdog-remote-aws-s3-cache' }
      >['options']
    >
  }
  'shadowdog-tag': { command: Command }
  'shadowdog-tree': { command: Command }
  'shadowdog-socket': {
    listener: Listener<
      Extract<z.infer<typeof pluginOptionsSchema>, { name: 'shadowdog-socket' }>['options']
    >
  }
  'shadowdog-git': { middleware: Middleware }
  'shadowdog-lock': {
    middleware: Middleware<
      Extract<z.infer<typeof pluginOptionsSchema>, { name: 'shadowdog-lock' }>['options']
    >
  }
}

const PLUGINS_MAP = {
  'shadowdog-rake': shadowdogRake,
  'shadowdog-local-cache': shadowdogLocalCache,
  'shadowdog-remote-aws-s3-cache': shadowdogRemoteAwsS3Cache,
  'shadowdog-tag': shadowdogTag,
  'shadowdog-tree': shadowdogTree,
  'shadowdog-socket': shadowdogSocket,
  'shadowdog-git': shadowdogGit,
  'shadowdog-lock': shadowdogLock,
} as const satisfies PluginsMap

const filterUsedPlugins = (config: PluginsConfig) =>
  config.map(({ name, options }) => ({
    name,
    fn: PLUGINS_MAP[name as keyof typeof PLUGINS_MAP],
    options,
  }))

export const filterMiddlewarePlugins = (config: PluginsConfig) => {
  return filterUsedPlugins(config).filter(
    (
      data,
    ): data is {
      name: keyof PluginsMap
      fn: Extract<PluginsMap[keyof PluginsMap], { middleware: Middleware<unknown> }>
      options: z.infer<typeof pluginOptionsSchema>['options']
    } => 'middleware' in data.fn,
  )
}

export const filterCommandPlugins = (pluginsConfig: PluginsConfig) => {
  return filterUsedPlugins(pluginsConfig).filter(
    (
      data,
    ): data is {
      name: keyof PluginsMap
      fn: { command: Command }
      options: z.infer<typeof pluginOptionsSchema>['options']
    } => 'command' in data.fn,
  )
}

export const filterEventListenerPlugins = (pluginsConfig: PluginsConfig) => {
  return filterUsedPlugins(pluginsConfig).filter(
    (
      data,
    ): data is {
      name: keyof PluginsMap
      fn: { listener: Listener<z.infer<typeof pluginOptionsSchema>['options']> }
      options: z.infer<typeof pluginOptionsSchema>['options']
    } => 'listener' in data.fn,
  )
}

export default PLUGINS_MAP
