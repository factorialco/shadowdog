import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js'
import { readFileSync, existsSync, statSync, rmSync, utimesSync } from 'fs'
import * as path from 'path'
import { createServer } from 'http'

import { Listener } from '.'
import { PluginConfig } from '../pluginTypes'
import { logMessage } from '../utils'
import chalk from 'chalk'
import { ConfigFile } from '../config'
import { ShadowdogEventEmitter } from '../events'

// Global state
let config: ConfigFile | null = null
let lockFilePath: string = ''
let server: Server | null = null
let httpServer: ReturnType<typeof createServer> | null = null
let eventEmitter: ShadowdogEventEmitter | null = null

// Pending changes tracking (similar to git plugin)
let pendingChangedFiles: string[] = []
let isPaused = false

// Interface for artifact data
interface ArtifactData {
  output: string
  command: string
  files: string[]
  environment: string[]
  lastUpdated?: string
  cacheIdentifier?: string
  outputSha?: string
}

// Helper to read lock file data
const readLockFileData = (): {
  artifacts: Array<{
    output: string
    outputSha: string
    cacheIdentifier: string
    fileManifest: {
      watchedFilesCount: number
      watchedFiles: string[]
      environment: Record<string, string>
      command: string
    }
  }>
} | null => {
  if (!lockFilePath || !existsSync(lockFilePath)) {
    return null
  }

  try {
    const content = readFileSync(lockFilePath, 'utf8')
    return JSON.parse(content)
  } catch {
    return null
  }
}

// Helper to get all artifacts from config and lock file
const getAllArtifacts = (): ArtifactData[] => {
  if (!config) {
    return []
  }

  const artifacts: ArtifactData[] = []
  const lockData = readLockFileData()

  for (const watcher of config.watchers) {
    for (const commandConfig of watcher.commands) {
      for (const artifact of commandConfig.artifacts) {
        const lockArtifact = lockData?.artifacts.find((a) => a.output === artifact.output)

        artifacts.push({
          output: artifact.output,
          command: commandConfig.command,
          files: lockArtifact?.fileManifest.watchedFiles || watcher.files,
          environment: watcher.environment,
          lastUpdated: lockArtifact
            ? new Date(
                existsSync(path.join(process.cwd(), artifact.output))
                  ? statSyncSafe(path.join(process.cwd(), artifact.output))?.mtime.toISOString() ||
                    ''
                  : '',
              ).toISOString()
            : undefined,
          cacheIdentifier: lockArtifact?.cacheIdentifier,
          outputSha: lockArtifact?.outputSha,
        })
      }
    }
  }

  return artifacts
}

// Safe stat sync helper
const statSyncSafe = (filePath: string) => {
  try {
    return statSync(filePath)
  } catch {
    return null
  }
}

// Helper to handle file changes when paused
const handleFileChange = (filePath: string) => {
  if (isPaused) {
    // Track the file change for later processing
    if (!pendingChangedFiles.includes(filePath)) {
      pendingChangedFiles.push(filePath)
    }
    return true // Indicates the change was handled (ignored)
  }
  return false // Indicates the change should be processed normally
}

// Helper to replay pending changes when resuming
const replayPendingChanges = () => {
  if (pendingChangedFiles.length === 0) {
    return
  }

  logMessage(
    `🔄 Replaying ${chalk.cyan(pendingChangedFiles.length)} file changes that occurred while paused...`,
  )

  const now = new Date()
  pendingChangedFiles.forEach((filePath) => {
    try {
      // Touch the file to trigger file watchers
      utimesSync(filePath, now, now)
      logMessage(`  ✓ Replayed: ${chalk.blue(filePath)}`)
    } catch (error) {
      logMessage(`  ✗ Failed to replay: ${chalk.red(filePath)} - ${(error as Error).message}`)
    }
  })

  logMessage(`✅ Successfully replayed ${chalk.cyan(pendingChangedFiles.length)} file changes.`)

  // Clear the pending changes
  pendingChangedFiles = []
}

// Helper to find command config for a specific artifact
const findCommandForArtifact = (
  artifactOutput: string,
): {
  command: string
  workingDirectory: string
  files: string[]
  environment: string[]
} | null => {
  if (!config) {
    return null
  }

  for (const watcher of config.watchers) {
    for (const commandConfig of watcher.commands) {
      for (const artifact of commandConfig.artifacts) {
        if (artifact.output === artifactOutput) {
          return {
            command: commandConfig.command,
            workingDirectory: commandConfig.workingDirectory,
            files: watcher.files,
            environment: watcher.environment,
          }
        }
      }
    }
  }

  return null
}

// MCP Tools definitions
const TOOLS: Tool[] = [
  {
    name: 'pause-shadowdog',
    description:
      'Pauses shadowdog when running in watch mode. Use this before making changes to prevent automatic artifact generation. This properly integrates with the daemon using events.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'resume-shadowdog',
    description:
      'Resumes shadowdog after being paused. Use this after finishing changes to re-enable automatic artifact generation. This properly integrates with the daemon using events.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get-artifacts',
    description:
      'Retrieves information about all artifacts being generated by shadowdog, including their status, last update time, and associated files.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          description:
            'Optional filter to search for specific artifacts by output path (case-insensitive substring match)',
        },
      },
      required: [],
    },
  },
  {
    name: 'compute-artifact',
    description:
      "Computes a specific artifact by triggering the daemon's artifact generation system. This properly integrates with shadowdog's artifact management system, respects configuration settings, uses the same task runner and middleware as the daemon, and provides consistent logging. This allows generating individual artifacts without running the entire build.",
    inputSchema: {
      type: 'object',
      properties: {
        artifactOutput: {
          type: 'string',
          description:
            'The output path of the artifact to compute (e.g., "build/app.js", "dist/styles.css", "docs/api.md")',
        },
      },
      required: ['artifactOutput'],
    },
  },
  {
    name: 'get-shadowdog-status',
    description:
      'Gets the current status of shadowdog, including daemon availability, configuration summary, and artifact information.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'clear-shadowdog-cache',
    description:
      "Clears shadowdog's local cache, lock files, and socket files. This removes all cached artifacts and forces a fresh build on the next run.",
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'compute-all-artifacts',
    description:
      "Computes all artifacts by triggering the daemon's artifact generation system for every configured artifact. This properly integrates with shadowdog's artifact management system, respects configuration settings, uses the same task runner and middleware as the daemon, and provides consistent logging. This allows generating all artifacts at once without running individual artifact commands.",
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
]

// Initialize MCP server
const initializeMCPServer = () => {
  if (server) {
    return // Already initialized
  }

  server = new Server(
    {
      name: 'shadowdog-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  )

  // Register tool handlers
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: TOOLS,
    }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    try {
      switch (name) {
        case 'pause-shadowdog': {
          if (!eventEmitter) {
            return {
              content: [
                {
                  type: 'text',
                  text: `❌ ${chalk.red('Error:')} Shadowdog daemon not available.`,
                },
              ],
              isError: true,
            }
          }

          isPaused = true
          eventEmitter.emit('pause')
          return {
            content: [
              {
                type: 'text',
                text: `⏸️  ${chalk.yellow('Successfully paused shadowdog.')} File changes will be tracked and replayed on resume.`,
              },
            ],
          }
        }

        case 'resume-shadowdog': {
          if (!eventEmitter) {
            return {
              content: [
                {
                  type: 'text',
                  text: `❌ ${chalk.red('Error:')} Shadowdog daemon not available.`,
                },
              ],
              isError: true,
            }
          }

          isPaused = false
          eventEmitter.emit('resume')

          // Replay any pending changes that occurred while paused
          replayPendingChanges()

          return {
            content: [
              {
                type: 'text',
                text: `▶️  ${chalk.green('Successfully resumed shadowdog.')} Automatic artifact generation is now enabled.`,
              },
            ],
          }
        }

        case 'get-artifacts': {
          const artifacts = getAllArtifacts()
          const filter = args?.filter as string | undefined

          const filteredArtifacts = filter
            ? artifacts.filter((a) => a.output.toLowerCase().includes(filter.toLowerCase()))
            : artifacts

          const artifactInfo = filteredArtifacts.map((artifact) => {
            const status = existsSync(path.join(process.cwd(), artifact.output))
              ? '✓ exists'
              : '✗ missing'
            return {
              output: artifact.output,
              status,
              command: artifact.command,
              lastUpdated: artifact.lastUpdated || 'unknown',
              watchedFiles: artifact.files.length,
              cacheIdentifier: artifact.cacheIdentifier,
              outputSha: artifact.outputSha,
            }
          })

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    total: filteredArtifacts.length,
                    artifacts: artifactInfo,
                  },
                  null,
                  2,
                ),
              },
            ],
          }
        }

        case 'compute-artifact': {
          const artifactOutput = args?.artifactOutput as string

          if (!artifactOutput) {
            return {
              content: [
                {
                  type: 'text',
                  text: `❌ ${chalk.red('Error:')} artifactOutput parameter is required`,
                },
              ],
              isError: true,
            }
          }

          if (!eventEmitter) {
            return {
              content: [
                {
                  type: 'text',
                  text: `❌ ${chalk.red('Error:')} Shadowdog daemon not available.`,
                },
              ],
              isError: true,
            }
          }

          // Check if artifact exists in config
          const commandInfo = findCommandForArtifact(artifactOutput)
          if (!commandInfo) {
            return {
              content: [
                {
                  type: 'text',
                  text: `❌ ${chalk.red('Error:')} No command found for artifact '${chalk.blue(artifactOutput)}'`,
                },
              ],
              isError: true,
            }
          }

          // Emit event to daemon to compute the artifact
          eventEmitter.emit('computeArtifact', { artifactOutput })

          return {
            content: [
              {
                type: 'text',
                text: `🔨 ${chalk.blue('Artifact computation request sent for')} '${chalk.cyan(artifactOutput)}'. Check the daemon logs for progress.`,
              },
            ],
          }
        }

        case 'get-shadowdog-status': {
          const artifacts = getAllArtifacts()
          const existingArtifacts = artifacts.filter((a) =>
            existsSync(path.join(process.cwd(), a.output)),
          )

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    daemonAvailable: eventEmitter !== null,
                    configLoaded: config !== null,
                    totalWatchers: config?.watchers.length || 0,
                    totalArtifacts: artifacts.length,
                    existingArtifacts: existingArtifacts.length,
                    lockFilePath: lockFilePath,
                    lockFileExists: existsSync(lockFilePath),
                  },
                  null,
                  2,
                ),
              },
            ],
          }
        }

        case 'clear-shadowdog-cache': {
          try {
            // Clear the main shadowdog temp directory
            const shadowdogTempDir = '/tmp/shadowdog'
            if (existsSync(shadowdogTempDir)) {
              rmSync(shadowdogTempDir, { recursive: true, force: true })
            }

            // Also clear the local lock file if it exists
            if (lockFilePath && existsSync(lockFilePath)) {
              rmSync(lockFilePath, { force: true })
            }

            return {
              content: [
                {
                  type: 'text',
                  text: `✅ ${chalk.green('Successfully cleared shadowdog cache.')} All cached artifacts, lock files, and socket files have been removed.`,
                },
              ],
            }
          } catch (error) {
            return {
              content: [
                {
                  type: 'text',
                  text: `❌ ${chalk.red('Error clearing cache:')} ${(error as Error).message}`,
                },
              ],
              isError: true,
            }
          }
        }

        case 'compute-all-artifacts': {
          if (!eventEmitter) {
            return {
              content: [
                {
                  type: 'text',
                  text: `❌ ${chalk.red('Error:')} Shadowdog daemon not available.`,
                },
              ],
              isError: true,
            }
          }

          if (!config) {
            return {
              content: [
                {
                  type: 'text',
                  text: `❌ ${chalk.red('Error:')} Shadowdog configuration not loaded.`,
                },
              ],
              isError: true,
            }
          }

          // Get all artifacts from config
          const allArtifacts = getAllArtifacts()

          if (allArtifacts.length === 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: `ℹ️  ${chalk.blue('No artifacts found in configuration.')} Nothing to compute.`,
                },
              ],
            }
          }

          // Emit event to daemon to compute all artifacts
          eventEmitter.emit('computeAllArtifacts', {
            artifacts: allArtifacts.map((artifact) => ({ output: artifact.output })),
          })

          return {
            content: [
              {
                type: 'text',
                text: `🔨 ${chalk.blue('All artifacts computation request sent.')} Computing ${chalk.cyan(allArtifacts.length)} artifacts. Check the daemon logs for progress.`,
              },
            ],
          }
        }

        default:
          return {
            content: [
              {
                type: 'text',
                text: `❌ ${chalk.red('Unknown tool:')} ${chalk.blue(name)}`,
              },
            ],
            isError: true,
          }
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ ${chalk.red('Error executing tool')} '${chalk.blue(name)}': ${(error as Error).message}`,
          },
        ],
        isError: true,
      }
    }
  })

  // Start the HTTP server
  const port = process.env.SHADOWDOG_MCP_PORT ? parseInt(process.env.SHADOWDOG_MCP_PORT) : 8473
  const host = process.env.SHADOWDOG_MCP_HOST || 'localhost'

  httpServer = createServer(async (req, res) => {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(200)
      res.end()
      return
    }

    if (req.method !== 'POST' || req.url !== '/mcp') {
      res.writeHead(404)
      res.end('Not Found')
      return
    }

    try {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk.toString()
      })

      req.on('end', async () => {
        try {
          const request = JSON.parse(body)

          // Handle the MCP request
          let response
          if (request.method === 'initialize') {
            response = {
              jsonrpc: '2.0',
              id: request.id,
              result: {
                protocolVersion: '2024-11-05',
                capabilities: {
                  tools: {},
                },
                serverInfo: {
                  name: 'shadowdog-mcp',
                  version: '1.0.0',
                },
              },
            }
          } else if (request.method === 'tools/list') {
            response = {
              jsonrpc: '2.0',
              id: request.id,
              result: { tools: TOOLS },
            }
          } else if (request.method === 'tools/call') {
            const toolName = request.params.name
            const toolArgs = request.params.arguments || {}

            // Call the appropriate tool
            let result
            switch (toolName) {
              case 'pause-shadowdog':
                if (!eventEmitter) {
                  result = {
                    content: [
                      {
                        type: 'text',
                        text: `❌ ${chalk.red('Error:')} Shadowdog daemon not available.`,
                      },
                    ],
                    isError: true,
                  }
                } else {
                  isPaused = true
                  eventEmitter.emit('pause')
                  result = {
                    content: [
                      {
                        type: 'text',
                        text: `⏸️  ${chalk.yellow('Successfully paused shadowdog.')} File changes will be tracked and replayed on resume.`,
                      },
                    ],
                  }
                }
                break
              case 'resume-shadowdog':
                if (!eventEmitter) {
                  result = {
                    content: [
                      {
                        type: 'text',
                        text: `❌ ${chalk.red('Error:')} Shadowdog daemon not available.`,
                      },
                    ],
                    isError: true,
                  }
                } else {
                  isPaused = false
                  eventEmitter.emit('resume')

                  // Replay any pending changes that occurred while paused
                  replayPendingChanges()

                  result = {
                    content: [
                      {
                        type: 'text',
                        text: `▶️  ${chalk.green('Successfully resumed shadowdog.')} Automatic artifact generation is now enabled.`,
                      },
                    ],
                  }
                }
                break
              case 'get-artifacts': {
                const artifacts = getAllArtifacts()
                const filter = toolArgs.filter
                const filteredArtifacts = filter
                  ? artifacts.filter((a) => a.output.toLowerCase().includes(filter.toLowerCase()))
                  : artifacts
                const artifactInfo = filteredArtifacts.map((artifact) => {
                  const status = existsSync(path.join(process.cwd(), artifact.output))
                    ? '✓ exists'
                    : '✗ missing'
                  return {
                    output: artifact.output,
                    status,
                    command: artifact.command,
                    lastUpdated: artifact.lastUpdated || 'unknown',
                    watchedFiles: artifact.files.length,
                    cacheIdentifier: artifact.cacheIdentifier,
                    outputSha: artifact.outputSha,
                  }
                })
                result = {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify(
                        { total: filteredArtifacts.length, artifacts: artifactInfo },
                        null,
                        2,
                      ),
                    },
                  ],
                }
                break
              }
              case 'compute-artifact': {
                const artifactOutput = toolArgs.artifactOutput
                if (!artifactOutput) {
                  result = {
                    content: [
                      {
                        type: 'text',
                        text: `❌ ${chalk.red('Error:')} artifactOutput parameter is required`,
                      },
                    ],
                    isError: true,
                  }
                } else if (!eventEmitter) {
                  result = {
                    content: [
                      {
                        type: 'text',
                        text: `❌ ${chalk.red('Error:')} Shadowdog daemon not available.`,
                      },
                    ],
                    isError: true,
                  }
                } else {
                  const commandInfo = findCommandForArtifact(artifactOutput)
                  if (!commandInfo) {
                    result = {
                      content: [
                        {
                          type: 'text',
                          text: `❌ ${chalk.red('Error:')} No command found for artifact '${chalk.blue(artifactOutput)}'`,
                        },
                      ],
                      isError: true,
                    }
                  } else {
                    eventEmitter.emit('computeArtifact', { artifactOutput })
                    result = {
                      content: [
                        {
                          type: 'text',
                          text: `🔨 ${chalk.blue('Artifact computation request sent for')} '${chalk.cyan(artifactOutput)}'. Check the daemon logs for progress.`,
                        },
                      ],
                    }
                  }
                }
                break
              }
              case 'get-shadowdog-status': {
                const allArtifacts = getAllArtifacts()
                const existingArtifacts = allArtifacts.filter((a) =>
                  existsSync(path.join(process.cwd(), a.output)),
                )
                result = {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify(
                        {
                          daemonAvailable: eventEmitter !== null,
                          configLoaded: config !== null,
                          totalWatchers: config?.watchers.length || 0,
                          totalArtifacts: allArtifacts.length,
                          existingArtifacts: existingArtifacts.length,
                          lockFilePath: lockFilePath,
                          lockFileExists: existsSync(lockFilePath),
                        },
                        null,
                        2,
                      ),
                    },
                  ],
                }
                break
              }
              case 'clear-shadowdog-cache': {
                try {
                  // Clear the main shadowdog temp directory
                  const shadowdogTempDir = '/tmp/shadowdog'
                  if (existsSync(shadowdogTempDir)) {
                    rmSync(shadowdogTempDir, { recursive: true, force: true })
                  }

                  // Also clear the local lock file if it exists
                  if (lockFilePath && existsSync(lockFilePath)) {
                    rmSync(lockFilePath, { force: true })
                  }

                  result = {
                    content: [
                      {
                        type: 'text',
                        text: `✅ ${chalk.green('Successfully cleared shadowdog cache.')} All cached artifacts, lock files, and socket files have been removed.`,
                      },
                    ],
                  }
                } catch (error) {
                  result = {
                    content: [
                      {
                        type: 'text',
                        text: `❌ ${chalk.red('Error clearing cache:')} ${(error as Error).message}`,
                      },
                    ],
                    isError: true,
                  }
                }
                break
              }
              case 'compute-all-artifacts': {
                if (!eventEmitter) {
                  result = {
                    content: [
                      {
                        type: 'text',
                        text: `❌ ${chalk.red('Error:')} Shadowdog daemon not available.`,
                      },
                    ],
                    isError: true,
                  }
                } else if (!config) {
                  result = {
                    content: [
                      {
                        type: 'text',
                        text: `❌ ${chalk.red('Error:')} Shadowdog configuration not loaded.`,
                      },
                    ],
                    isError: true,
                  }
                } else {
                  // Get all artifacts from config
                  const allArtifacts = getAllArtifacts()

                  if (allArtifacts.length === 0) {
                    result = {
                      content: [
                        {
                          type: 'text',
                          text: `ℹ️  ${chalk.blue('No artifacts found in configuration.')} Nothing to compute.`,
                        },
                      ],
                    }
                  } else {
                    // Emit event to daemon to compute all artifacts
                    eventEmitter.emit('computeAllArtifacts', {
                      artifacts: allArtifacts.map((artifact) => ({ output: artifact.output })),
                    })

                    result = {
                      content: [
                        {
                          type: 'text',
                          text: `🔨 ${chalk.blue('All artifacts computation request sent.')} Computing ${chalk.cyan(allArtifacts.length)} artifacts. Check the daemon logs for progress.`,
                        },
                      ],
                    }
                  }
                }
                break
              }
              default:
                result = {
                  content: [
                    {
                      type: 'text',
                      text: `❌ ${chalk.red('Unknown tool:')} ${chalk.blue(toolName)}`,
                    },
                  ],
                  isError: true,
                }
            }

            response = {
              jsonrpc: '2.0',
              id: request.id,
              result,
            }
          } else {
            response = {
              jsonrpc: '2.0',
              id: request.id,
              error: { code: -32601, message: 'Method not found' },
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(response))
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: null,
              error: { code: -32700, message: 'Parse error' },
            }),
          )
        }
      })
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32603, message: 'Internal error' },
        }),
      )
    }
  })

  httpServer.listen(port, host, () => {
    const serverUrl = `http://${host}:${port}/mcp`
    logMessage(`🔌 MCP Server initialized and ready at ${chalk.green(serverUrl)}`)

    // Only show connection details when running in MCP mode
    if (process.argv.includes('--mcp')) {
      logMessage(`📋 To connect from Cursor, add to your MCP config:`)
      logMessage(`   ${chalk.yellow(`"shadowdog-mcp": { "url": "${serverUrl}" }`)}`)
      logMessage(
        `   Available tools: pause-shadowdog, resume-shadowdog, get-artifacts, compute-artifact, compute-all-artifacts, get-shadowdog-status, clear-shadowdog-cache`,
      )
      logMessage(
        `🔗 Setup guide: ${chalk.underline('https://cursor.com/docs/context/mcp/install-links')}`,
      )
    }
  })

  httpServer.on('error', (error: Error) => {
    logMessage(`❌ ${chalk.red('HTTP Server error:')} ${error.message}`)
  })
}

// Event listener plugin implementation
const listener: Listener<PluginConfig<'shadowdog-mcp'>> = (eventEmitterParam) => {
  // Store event emitter reference
  eventEmitter = eventEmitterParam

  // Initialize lock file path
  lockFilePath = path.resolve(process.cwd(), 'shadowdog-lock.json')

  // Store config reference when it's loaded
  eventEmitter.on('configLoaded', ({ config: loadedConfig }) => {
    config = loadedConfig as ConfigFile
  })

  // Initialize MCP server when shadowdog initializes
  eventEmitter.on('initialized', () => {
    initializeMCPServer()
  })

  // Listen for file changes to track them when paused
  eventEmitter.on('changed', ({ path: filePath }) => {
    handleFileChange(filePath)
  })

  // Clean up on exit
  eventEmitter.on('exit', () => {
    if (httpServer) {
      httpServer.close(() => {
        logMessage(`🔌 MCP HTTP Server closed`)
      })
    }
    if (server) {
      server.close().catch((error) => {
        logMessage(`❌ Failed to close MCP server: ${chalk.red(error.message)}`)
      })
    }
  })
}

export default {
  listener,
}
