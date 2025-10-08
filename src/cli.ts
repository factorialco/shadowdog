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

cli
  .version(pjson.version)
  .description(
    'A blazing fast build system with intelligent caching, file watching, and MCP integration',
  )

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
  .option('--mcp', 'Start in MCP server mode for external tool integration')
  .action(async ({ config: configFilePath, watch, mcp }) => {
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

    if (mcp) {
      logMessage(
        `🔌 ${chalk.blue('Shadowdog MCP Server')} ${chalk.blue(readShadowdogVersion())} is starting...`,
      )

      const configRelativePath = path.relative(process.cwd(), configFilePath)
      const config = loadConfig(configRelativePath)

      // Only initialize MCP plugin in MCP mode
      const mcpPlugin = config.plugins.find((p) => p.name === 'shadowdog-mcp')
      if (mcpPlugin) {
        const { default: shadowdogMcp } = await import('./plugins/shadowdog-mcp')
        shadowdogMcp.listener(eventEmitter, mcpPlugin.options ?? {})
      } else {
        logMessage(
          `⚠️  ${chalk.yellow('shadowdog-mcp plugin not found in config. Add it to enable MCP server.')}`,
        )
        return exit(eventEmitter, 1)
      }

      // Emit config loaded event for plugins that need access to the full config
      eventEmitter.emit('configLoaded', { config })

      // Initialize MCP server
      eventEmitter.emit('initialized')

      // Keep the process alive for HTTP MCP communication
      // The HTTP server will keep the process running

      return
    }

    logMessage(`🚀 Shadowdog ${chalk.blue(readShadowdogVersion())} is booting!`)

    const configRelativePath = path.relative(process.cwd(), configFilePath)
    const config = loadConfig(configRelativePath)

    filterEventListenerPlugins(config.plugins).forEach(({ fn, options }) => {
      fn.listener(eventEmitter, options ?? {})
    })

    // Emit config loaded event for plugins that need access to the full config
    eventEmitter.emit('configLoaded', { config })

    // Emit generate started event
    eventEmitter.emit('generateStarted')

    try {
      await generate(config, eventEmitter, { continueOnError: watch })

      // Emit allTasksComplete event after generate phase completes
      eventEmitter.emit('allTasksComplete')
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
