import * as crypto from 'crypto'
import * as glob from 'glob'
import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import { ShadowdogEventEmitter } from './events'

export const logMessage = (message: string) => {
  console.log(message)
}

export const logError = (error: Error) => {
  if (process.env.DEBUG) {
    console.error(chalk.red(new Error(error.stack)))
  }
}

export const chalkFiles = (files: string[]) =>
  files.map((file) => `'${chalk.blue(file)}'`).join(', ')

export const readShadowdogVersion = () => {
  const packageJsonPath = path.resolve(__dirname, '../package.json')
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
  return packageJson.version
}

export const exit = async (eventEmitter: ShadowdogEventEmitter, code: number) => {
  // emit exit event and wait for all listeners to complete
  await Promise.all(eventEmitter.listeners('exit').map((listener) => listener()))
  eventEmitter.removeAllListeners()

  process.exit(code)
}

// Helper function to check if a file matches an ignore pattern
const matchesIgnorePattern = (filePath: string, pattern: string): boolean => {
  // Handle exact matches
  if (pattern === filePath) {
    return true
  }

  // Handle directory patterns (e.g., "node_modules" should match "any/path/node_modules" and "any/path/node_modules/anything")
  if (pattern.endsWith('/') || !pattern.includes('*')) {
    const normalizedPattern = pattern.endsWith('/') ? pattern.slice(0, -1) : pattern
    return filePath === normalizedPattern || filePath.startsWith(normalizedPattern + '/')
  }

  // Handle glob patterns with ** (e.g., "**/node_modules")
  if (pattern.startsWith('**/')) {
    const suffix = pattern.slice(3) // Remove "**/" prefix
    return filePath.includes(suffix) || filePath.endsWith(suffix)
  }

  // Handle glob patterns with * (e.g., "*.log")
  if (pattern.includes('*')) {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\./g, '\\.') // Escape dots
      .replace(/\*/g, '.*') // Convert * to .*
      .replace(/\*\*/g, '.*') // Convert ** to .*
    const regex = new RegExp(`^${regexPattern}$`)
    return regex.test(filePath)
  }

  return false
}

export const processFiles = (
  files: string[],
  ignoredFiles: string[] = [],
  preserveNonExistent: boolean = false,
): string[] => {
  // Expand glob patterns and filter to files only
  const allFiles = files
    .map((file) => path.join(process.cwd(), file))
    .flatMap((globPath) => {
      const matches = glob.sync(globPath)
      // If preserveNonExistent is true and no matches found, keep the original path
      // This is important for dependency tracking when files don't exist yet
      if (preserveNonExistent && matches.length === 0 && !globPath.includes('*')) {
        return [globPath]
      }
      return matches
    })
    .filter((filePath) => {
      // If preserveNonExistent is true, don't filter out non-existent files
      // unless they contain glob patterns (which should have been resolved)
      if (preserveNonExistent && !path.relative(process.cwd(), filePath).includes('*')) {
        try {
          return fs.statSync(filePath).isFile()
        } catch {
          // File doesn't exist, but we want to preserve it for dependency tracking
          return true
        }
      }
      return fs.statSync(filePath).isFile()
    })
    .sort()

  if (ignoredFiles.length === 0) {
    return allFiles.map((filePath) => path.relative(process.cwd(), filePath))
  }

  // Convert to relative paths for pattern matching
  const relativeFiles = allFiles.map((filePath) => path.relative(process.cwd(), filePath))

  // Filter out ignored files using efficient pattern matching
  return relativeFiles.filter((file) => {
    return !ignoredFiles.some((pattern) => matchesIgnorePattern(file, pattern))
  })
}

export const computeCache = (files: string[], environment: string[], command: string) => {
  const hash = crypto.createHmac('sha1', '')

  files.forEach((filePath) => {
    hash.update(filePath)
    hash.update(fs.readFileSync(path.join(process.cwd(), filePath), 'utf-8'))
  })

  environment.forEach((env) => hash.update(process.env[env] ?? ''))

  hash.update(command)
  hash.update(readShadowdogVersion())
  hash.update(process.version)

  return hash.digest('hex').slice(0, 10)
}

export const computeFileCacheName = (currentCache: string, fileName: string) => {
  const hash = crypto.createHmac('sha1', '')

  hash.update(currentCache)
  hash.update(fileName)

  return hash.digest('hex').slice(0, 10)
}
