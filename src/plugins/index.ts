/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod'

import { CommandConfig, PluginsConfig, InvalidatorConfig } from '../config'
import { Task } from '../generate'

import shadowdogLocalCache from './shadowdog-local-cache'
import shadowdogRake from './shadowdog-rake'
import shadowdogTag from './shadowdog-tag'
import shadowdogRemoteAwsS3Cache from './shadowdog-remote-aws-s3-cache'
import shadowdogTree from './shadowdog-tree'
import shadowdogSocket from './shadowdog-socket'
import shadowdogGit from './shadowdog-git'
import { ShadowdogEventEmitter } from '../events'

export type Listener<Options = any> = (
  shadowdogEventListener: ShadowdogEventEmitter,
  options: Options,
) => void

export type Command = (activeWatchers: Task) => Task

export type Middleware<Options = any> = (control: {
  files: string[]
  invalidators: InvalidatorConfig
  config: CommandConfig
  options: Options
  next: () => Promise<unknown>
  abort: () => void
  changedFilePath?: string
  eventEmitter?: ShadowdogEventEmitter
}) => Promise<unknown>

type MiddlewarePlugin = { middleware: Middleware }
type CommandPlugin = { command: Command }
type EventListenerPlugin = { listener: Listener }

export const PluginNameEnum = z.enum([
  'shadowdog-rake',
  'shadowdog-local-cache',
  'shadowdog-remote-aws-s3-cache',
  'shadowdog-tag',
  'shadowdog-tree',
  'shadowdog-socket',
  'shadowdog-git',
])

type PluginName = z.infer<typeof PluginNameEnum>

const PLUGINS_MAP: Record<PluginName, MiddlewarePlugin | CommandPlugin | EventListenerPlugin> = {
  'shadowdog-rake': shadowdogRake,
  'shadowdog-local-cache': shadowdogLocalCache,
  'shadowdog-remote-aws-s3-cache': shadowdogRemoteAwsS3Cache,
  'shadowdog-tag': shadowdogTag,
  'shadowdog-tree': shadowdogTree,
  'shadowdog-socket': shadowdogSocket,
  'shadowdog-git': shadowdogGit,
} as const

const filterUsedPlugins = (config: PluginsConfig) =>
  config.map(({ name, options }) => ({
    name,
    fn: PLUGINS_MAP[name],
    options,
  }))

export const filterMiddlewarePlugins = (config: PluginsConfig) => {
  return filterUsedPlugins(config).filter(
    (data): data is { name: PluginName; fn: MiddlewarePlugin; options: unknown } =>
      'middleware' in data.fn,
  )
}

export const filterCommandPlugins = (pluginsConfig: PluginsConfig) => {
  return filterUsedPlugins(pluginsConfig).filter(
    (data): data is { name: PluginName; fn: CommandPlugin; options: unknown } =>
      'command' in data.fn,
  )
}

export const filterEventListenerPlugins = (pluginsConfig: PluginsConfig) => {
  return filterUsedPlugins(pluginsConfig).filter(
    (data): data is { name: PluginName; fn: EventListenerPlugin; options: unknown } =>
      'listener' in data.fn,
  )
}

export default PLUGINS_MAP
