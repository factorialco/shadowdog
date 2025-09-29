// fs-extra is used for ensureDir but we're not using it directly in this file
import { writeFileSync, readFileSync } from 'fs'
import * as path from 'path'

import chalk from 'chalk'
import { Listener } from '.'
import { PluginConfig } from '../pluginTypes'
import {
  logMessage,
  readShadowdogVersion,
  computeCache,
  computeFileCacheName,
  processFiles,
} from '../utils'
import { ArtifactConfig, ConfigFile } from '../config'

// Lock file structure interfaces
interface LockFileArtifact {
  output: string
  cacheIdentifier: string
  fileManifest: {
    watchedFilesCount: number
    watchedFiles: string[]
    environment: Record<string, string>
    command: string
  }
}

interface ShadowdogLockFile {
  version: string
  nodeVersion: string
  artifacts: LockFileArtifact[]
}

// Global state
let lockFilePath: string = ''
let config: ConfigFile | null = null
let writePromise: Promise<void> | null = null
let isInGenerateMode: boolean = false

// Function to detect and resolve merge conflicts in lock file
const detectAndResolveConflicts = (filePath: string): boolean => {
  try {
    const content = readFileSync(filePath, 'utf8')

    // Check for common merge conflict markers
    if (content.includes('<<<<<<<') || content.includes('=======') || content.includes('>>>>>>>')) {
      logMessage(`🔧 Detected merge conflicts in lock file. Regenerating from scratch...`)
      return true
    }

    // Check if the file is valid JSON
    try {
      JSON.parse(content)
    } catch {
      logMessage(`🔧 Lock file contains invalid JSON. Regenerating from scratch...`)
      return true
    }

    return false
  } catch {
    // File doesn't exist or can't be read, that's fine
    return false
  }
}

// Helper functions

const createArtifactEntry = (
  artifact: ArtifactConfig,
  files: string[],
  environment: string[],
  command: string,
): LockFileArtifact => {
  // Capture actual environment variable values (obfuscated for security)
  const environmentValues: Record<string, string> = {}
  environment.forEach((envVar) => {
    const value = process.env[envVar] ?? ''
    // Obfuscate values to prevent leaking tokens/secrets
    const obfuscatedValue =
      value.length > 0
        ? `${value.slice(0, 2)}${'*'.repeat(Math.max(4, value.length - 4))}${value.slice(-2)}`
        : ''
    environmentValues[envVar] = obfuscatedValue
  })

  // Use the same cache computation as the local cache plugin
  const currentCache = computeCache(files, environment, command)
  const artifactCacheIdentifier = computeFileCacheName(currentCache, artifact.output)

  return {
    output: artifact.output,
    cacheIdentifier: artifactCacheIdentifier,
    fileManifest: {
      watchedFilesCount: files.length,
      watchedFiles: files,
      environment: environmentValues,
      command,
    },
  }
}

const regenerateLockFile = async () => {
  if (!config) {
    return
  }

  // Wait for any existing write operation to complete
  if (writePromise) {
    await writePromise
  }

  // Create new write promise to prevent race conditions
  writePromise = (async () => {
    const start = Date.now()

    // Initialize lock file path if not already done
    if (!lockFilePath) {
      lockFilePath = path.resolve(process.cwd(), 'shadowdog-lock.json')
    }

    // Note: Conflict detection is already done in configLoaded event
    // This function will regenerate the lock file regardless

    // Generate all artifacts in deterministic order based on shadowdog.json
    const allArtifacts: LockFileArtifact[] = []

    for (const watcherConfig of config.watchers) {
      // Process files with ignores
      const processedFiles = processFiles(watcherConfig.files, [
        ...(watcherConfig.ignored || []),
        ...config.defaultIgnoredFiles,
      ])

      for (const commandConfig of watcherConfig.commands) {
        for (const artifact of commandConfig.artifacts) {
          const artifactEntry = createArtifactEntry(
            artifact,
            processedFiles,
            watcherConfig.environment,
            commandConfig.command,
          )
          allArtifacts.push(artifactEntry)
        }
      }
    }

    const lockFile: ShadowdogLockFile = {
      version: readShadowdogVersion(),
      nodeVersion: process.version,
      artifacts: allArtifacts,
    }

    // Skip directory creation since the file already exists
    // await fs.ensureDir(path.dirname(lockFilePath))

    try {
      // Use synchronous write to avoid hanging issues
      const jsonContent = JSON.stringify(lockFile, null, 2)
      writeFileSync(lockFilePath, jsonContent, 'utf8')

      const seconds = ((Date.now() - start) / 1000).toFixed(2)
      const relativeLockPath = path.relative(process.cwd(), lockFilePath)
      const artifactCount = allArtifacts.length
      const artifactNames = allArtifacts.map((a) => a.output).join(', ')
      logMessage(
        `📝 Lock file regenerated at '${chalk.blue(relativeLockPath)}' with ${chalk.blue(artifactCount)} artifacts: ${chalk.green(artifactNames)} ${chalk.cyan(`(${seconds}s)`)}`,
      )
    } catch (error) {
      logMessage(`❌ Failed to write lock file: ${(error as Error).message}`)
    }
  })()

  await writePromise
}

// Event listener plugin implementation
const listener: Listener<PluginConfig<'shadowdog-lock'>> = (eventEmitter) => {
  // Store config reference when it's loaded
  eventEmitter.on('configLoaded', ({ config: loadedConfig }) => {
    config = loadedConfig as ConfigFile

    // Initialize lock file path and check for conflicts early
    if (!lockFilePath) {
      lockFilePath = path.resolve(process.cwd(), 'shadowdog-lock.json')
    }

    // Check for merge conflicts and resolve them immediately
    if (detectAndResolveConflicts(lockFilePath)) {
      // Regenerate immediately to resolve conflicts
      regenerateLockFile()
    }
  })

  // Mark when generate mode starts
  eventEmitter.on('generateStarted', () => {
    isInGenerateMode = true
  })

  // Regenerate lock file after all tasks complete in generate mode
  eventEmitter.on('allTasksComplete', async () => {
    isInGenerateMode = false // Mark that generate mode is complete
    await regenerateLockFile()
  })

  // Regenerate lock file after each task completion in daemon mode only
  // (not during the initial generate phase)
  eventEmitter.on('end', async () => {
    // Only regenerate in daemon mode (when not in generate mode)
    if (!isInGenerateMode && config && lockFilePath) {
      await regenerateLockFile()
    }
  })
}

export default {
  listener,
}
