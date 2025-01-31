#!/usr/bin/env node
import { Command } from 'commander'
import pjson from '../package.json'
import path from 'path'
import { runDaemon } from './daemon'
import { generate } from './generate'
import { logError, logMessage, readShadowdogVersion, exit } from './utils'
import chalk from 'chalk'
import { ShadowdogEventEmitter } from './events'
import { filterEventListenerPlugins } from './plugins'
import { loadConfig } from './config'

const DEFAULT_CONFIG_FILENAME = 'shadowdog.json'

const cli = new Command()

const eventEmitter = new ShadowdogEventEmitter()

cli.version(pjson.version).description('TBA')

cli
  .option(
    '-c, --config <path>',
    `Config file path (default: ${DEFAULT_CONFIG_FILENAME} in current working directory)`,
    path.join(process.cwd(), DEFAULT_CONFIG_FILENAME),
  )
  .option(
    '-w, --watch',
    'Watch for changes in the configured files and run the tasks automatically',
  )
  .action(async ({ config: configFilePath, watch }) => {
    if (watch) {
      logMessage(
        `
    ███████╗██╗  ██╗ █████╗ ██████╗  ██████╗ ██╗    ██╗██████╗  ██████╗  ██████╗
    ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔══██╗██╔═══██╗██╔════╝
    ███████╗███████║███████║██║  ██║██║   ██║██║ █╗ ██║██║  ██║██║   ██║██║  ███╗
    ╚════██║██╔══██║██╔══██║██║  ██║██║   ██║██║███╗██║██║  ██║██║   ██║██║   ██║
    ███████║██║  ██║██║  ██║██████╔╝╚██████╔╝╚███╔███╔╝██████╔╝╚██████╔╝╚██████╔╝
    ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝  ╚═════╝  ╚══╝╚══╝ ╚═════╝  ╚═════╝  ╚═════╝
    `,
      )
    }

    logMessage(`🚀 Shadowdog ${chalk.blue(readShadowdogVersion())} is booting!`)

    const configRelativePath = path.relative(process.cwd(), configFilePath)
    const config = loadConfig(configRelativePath)

    filterEventListenerPlugins(config.plugins).forEach(({ fn, options }) => {
      fn.listener(eventEmitter, options ?? {})
    })

    try {
      await generate(config, eventEmitter, { continueOnError: watch })
    } catch (error: unknown) {
      logMessage(`🚫 Unable to perform the initial generation because some command has failed.`)
      logError(error as Error)
      return exit(eventEmitter, 1)
    }

    if (watch) {
      runDaemon(config, configRelativePath, eventEmitter)
    } else {
      return exit(eventEmitter, 0)
    }
  })

cli.parse(process.argv)
