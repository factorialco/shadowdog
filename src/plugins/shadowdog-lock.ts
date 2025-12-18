// fs-extra is used for ensureDir but we're not using it directly in this file
import { writeFileSync, readFileSync, statSync } from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { sync as globSync } from 'glob'

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
  outputSha: string
  cacheIdentifier: string
  executionTime: number
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
// Track execution times per artifact (keyed by artifact output)
const artifactExecutionTimes = new Map<string, number>()
const artifactStartTimes = new Map<string, number>()

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

// Compute SHA256 hash of artifact content
const computeArtifactContentSha = (artifactPath: string): string => {
  try {
    const fullPath = path.join(process.cwd(), artifactPath)
    const stats = statSync(fullPath)

    if (stats.isDirectory()) {
      // For directories, create a hash based on all file contents and structure
      const files = globSync('**/*', { cwd: fullPath, nodir: true }).sort()

      const hash = crypto.createHash('sha256')
      hash.update(`directory:${artifactPath}`)

      for (const file of files) {
        const filePath = path.join(fullPath, file)
        hash.update(`file:${file}`)
        try {
          const content = readFileSync(filePath)
          hash.update(content)
        } catch {
          // Skip files that can't be read
          hash.update('unreadable')
        }
      }

      return hash.digest('hex').slice(0, 10)
    } else {
      // For files, hash the content directly
      const content = readFileSync(fullPath)
      const hash = crypto.createHash('sha256')
      hash.update(content)
      return hash.digest('hex').slice(0, 10)
    }
  } catch {
    // If artifact doesn't exist or can't be read, return a placeholder
    return 'not-found'
  }
}

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

  // Compute SHA of the artifact content
  const outputSha = computeArtifactContentSha(artifact.output)

  // Get execution time for this artifact (default to 0 if not tracked)
  const executionTime = artifactExecutionTimes.get(artifact.output) ?? 0

  return {
    output: artifact.output,
    outputSha,
    cacheIdentifier: artifactCacheIdentifier,
    executionTime,
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
        `📝 Lock file regenerated at '${chalk.blue(relativeLockPath)}' with ${chalk.blue(artifactCount)} artifacts: ${chalk.blue(artifactNames)} ${chalk.cyan(`(${seconds}s)`)}`,
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
    // Clear execution times when starting a new generation
    artifactExecutionTimes.clear()
    artifactStartTimes.clear()
  })

  // Regenerate lock file after all tasks complete in generate mode
  eventEmitter.on('allTasksComplete', async () => {
    isInGenerateMode = false // Mark that generate mode is complete
    await regenerateLockFile()
  })

  // Track when artifacts begin execution
  eventEmitter.on('begin', ({ artifacts }) => {
    const startTime = Date.now()
    for (const artifact of artifacts) {
      artifactStartTimes.set(artifact.output, startTime)
    }
  })

  // Track when artifacts end execution and calculate execution time
  eventEmitter.on('end', async ({ artifacts }) => {
    const endTime = Date.now()
    for (const artifact of artifacts) {
      const startTime = artifactStartTimes.get(artifact.output)
      if (startTime !== undefined) {
        const executionTime = (endTime - startTime) / 1000 // Convert to seconds
        artifactExecutionTimes.set(artifact.output, executionTime)
        artifactStartTimes.delete(artifact.output)
      }
    }

    // Regenerate lock file after each task completion in daemon mode only
    // (not during the initial generate phase)
    if (!isInGenerateMode && config && lockFilePath) {
      await regenerateLockFile()
    }
  })
}

export default {
  listener,
}
