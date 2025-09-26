import * as fs from 'fs-extra'
import * as path from 'path'

import chalk from 'chalk'
import { Middleware } from '.'
import { PluginConfig } from '../pluginTypes'
import { logMessage, readShadowdogVersion, computeCache, computeFileCacheName } from '../utils'
import { ArtifactConfig } from '../config'

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
let writePromise: Promise<void> | null = null

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

const writeLockFile = async (newArtifacts: Map<string, LockFileArtifact>) => {
  // Wait for any existing write operation to complete
  if (writePromise) {
    await writePromise
  }

  // Create new write promise to prevent race conditions
  writePromise = (async () => {
    // Read existing lock file if it exists
    let existingLockFile: ShadowdogLockFile | null = null
    try {
      if (await fs.pathExists(lockFilePath)) {
        existingLockFile = await fs.readJSON(lockFilePath)
      }
    } catch {
      // If we can't read the existing file, start fresh
      existingLockFile = null
    }

    // Merge with existing artifacts, updating only the ones that changed
    const allArtifacts = new Map<string, LockFileArtifact>()

    // Add existing artifacts (if any)
    if (existingLockFile?.artifacts) {
      for (const artifact of existingLockFile.artifacts) {
        allArtifacts.set(artifact.output, artifact)
      }
    }

    // Update with new artifacts
    for (const [output, artifact] of newArtifacts) {
      allArtifacts.set(output, artifact)
    }

    // Sort artifacts by output path for deterministic ordering
    const sortedArtifacts = Array.from(allArtifacts.values()).sort((a, b) =>
      a.output.localeCompare(b.output),
    )

    const lockFile: ShadowdogLockFile = {
      version: readShadowdogVersion(),
      nodeVersion: process.version,
      artifacts: sortedArtifacts,
    }

    try {
      await fs.ensureDir(path.dirname(lockFilePath))
      await fs.writeJSON(lockFilePath, lockFile, { spaces: 2 })
      const relativeLockPath = path.relative(process.cwd(), lockFilePath)
      const artifactNames = Array.from(newArtifacts.keys()).join(', ')
      const cacheIds = Array.from(newArtifacts.values())
        .map((a) => a.cacheIdentifier)
        .join(', ')
      logMessage(
        `📝 Lock file written to '${chalk.blue(relativeLockPath)}' updated: '${chalk.blue(artifactNames)}' with id '${chalk.green(cacheIds)}'`,
      )
    } catch (error) {
      logMessage(`❌ Failed to write lock file: ${(error as Error).message}`)
    }
  })()

  await writePromise
}

// Middleware plugin implementation - back to this because events don't have enough data
const middleware: Middleware<PluginConfig<'shadowdog-lock'>> = async ({
  files,
  environment,
  config,
  next,
}) => {
  // Initialize lock file path if not already done
  if (!lockFilePath) {
    lockFilePath = path.resolve(process.cwd(), 'shadowdog-lock.json')
  }

  // Create artifact entries for this task
  const taskArtifacts = new Map<string, LockFileArtifact>()

  for (const artifact of config.artifacts) {
    const artifactEntry = createArtifactEntry(artifact, files, environment, config.command)
    taskArtifacts.set(artifact.output, artifactEntry)
  }

  // Execute the next middleware/task
  await next()

  // Write lock file with partial update (after task completion to avoid race conditions)
  await writeLockFile(taskArtifacts)
}

export default {
  middleware,
}
