#!/usr/bin/env node
import { Command } from 'commander'
import pjson from '../package.json'
import path from 'path'
import { runDaemon } from './daemon'
import { generate } from './generate'
import { logError, logMessage, readShadowdogVersion } from './utils'
import chalk from 'chalk'

const DEFAULT_CONFIG_FILENAME = 'shadowdog.json'

const cli = new Command()

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
  .action(async ({ config, watch }) => {
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

    try {
      await generate(path.relative(process.cwd(), config))
    } catch (error: unknown) {
      logMessage(`🚫 Unable to perform the initial generation because some command has failed.`)
      logError(error as Error)
    }

    if (watch) {
      runDaemon(path.relative(process.cwd(), config))
    }
  })

cli.parse(process.argv)
