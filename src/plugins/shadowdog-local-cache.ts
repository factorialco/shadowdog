import * as fs from 'fs-extra'
import * as path from 'path'
import * as tar from 'tar'
import * as zlib from 'zlib'

import chalk from 'chalk'
import { Middleware } from '.'
import { CommandConfig } from '../config'
import { PluginConfig } from '../pluginTypes'
import { computeCache, computeFileCacheName, logError, logMessage } from '../utils'

type FilterFn = (file: string) => boolean

export const compressArtifact = (folderPath: string, outputPath: string, filter?: FilterFn) => {
  return new Promise((resolve, reject) => {
    const tarStream = tar.c(
      {
        gzip: false,
        cwd: path.dirname(folderPath),
        filter,
      },
      [path.basename(folderPath)],
    )
    const gzipStream = zlib.createGzip()
    const writeStream = fs.createWriteStream(outputPath)

    writeStream.on('finish', () => {
      resolve(null)
    })

    writeStream.on('error', reject)
    gzipStream.on('error', reject)
    tarStream.on('error', reject)

    tarStream.pipe(gzipStream).pipe(writeStream)
  })
}

const decompressArtifact = (tarGzPath: string, outputPath: string, filter: FilterFn) => {
  return new Promise((resolve, reject) => {
    fs.mkdirpSync(outputPath)

    const readStream = fs.createReadStream(tarGzPath)
    const unzipStream = zlib.createGunzip()
    const tarExtractStream = tar.x({ cwd: outputPath, filter })

    tarExtractStream.on('finish', () => {
      resolve(null)
    })
    tarExtractStream.on('error', (err) => {
      reject(err)
    })
    unzipStream.on('error', (err) => {
      reject(err)
    })

    readStream.pipe(unzipStream).pipe(tarExtractStream)
  })
}

const restoreCache = async (
  commandConfig: CommandConfig,
  currentCache: string,
  { path: cachePath }: PluginConfig<'shadowdog-local-cache'>,
) => {
  // Check if we can reuse some artifacts from the cache
  const promisesToGenerate = commandConfig.artifacts.map(async (artifact) => {
    const start = Date.now()
    const cacheFileName = computeFileCacheName(currentCache, artifact.output)
    const cacheFilePath = path.join(cachePath, `${cacheFileName}.tar.gz`)

    // First, we check if the artifact is in the local file system cache
    if (fs.existsSync(cacheFilePath)) {
      logMessage(
        `📦 Reusing artifact '${chalk.blue(artifact.output)}' with id '${chalk.green(
          cacheFileName,
        )}' from local cache because of cache ${chalk.bgGreen('HIT')}`,
      )

      try {
        await decompressArtifact(
          cacheFilePath,
          path.join(process.cwd(), artifact.output, '..'),
          (filePath) => filterFn(artifact.ignore, artifact.output, filePath),
        )
      } catch (error: unknown) {
        logMessage(
          `🚫 An error ocurred while restoring cache for artifact '${chalk.blue(
            artifact.output,
          )}' with id '${chalk.green(cacheFileName)}'`,
        )
        logError(error as Error)

        return artifact
      }

      return null
    }

    const seconds = ((Date.now() - start) / 1000).toFixed(2)

    logMessage(
      `📦 Not able to reuse artifact '${chalk.blue(artifact.output)}' with id '${chalk.green(
        cacheFileName,
      )}' from cache because of cache ${chalk.bgRed('MISS')} ${chalk.cyan(`(${seconds}s)`)}`,
    )

    // If we can't reuse the artifact, we return it so it can be generated
    return artifact
  })

  const artifactToGenerate = await Promise.all(promisesToGenerate)

  if (
    commandConfig.artifacts &&
    commandConfig.artifacts.length > 0 &&
    artifactToGenerate.filter(Boolean).length === 0 // Filtering out the artifacts that were reused from cache
  ) {
    logMessage(
      `⤵️  Skipping command '${chalk.yellow(
        commandConfig.command,
      )}' generation because all artifacts were reused from cache`,
    )

    return true
  }

  return false
}

const filterFn = (ignore: string[] | undefined, outputPath: string, filePath: string) => {
  if (!ignore) {
    return true
  }

  const keep = !ignore.includes(path.join(outputPath, '..', filePath))

  if (!keep) {
    logMessage(
      `🗜️  Ignored file '${chalk.blue(filePath)}' during compression because of the ignore list`,
    )
  }

  return keep
}

const middleware: Middleware<PluginConfig<'shadowdog-local-cache'>> = async ({
  files,
  environment,
  config,
  next,
  abort,
  options,
}) => {
  if (process.env.SHADOWDOG_DISABLE_LOCAL_CACHE) {
    return next()
  }

  const readCache = process.env.SHADOWDOG_LOCAL_CACHE_READ
    ? process.env.SHADOWDOG_LOCAL_CACHE_READ === 'true'
    : options.read

  const writeCache = process.env.SHADOWDOG_LOCAL_CACHE_WRITE
    ? process.env.SHADOWDOG_LOCAL_CACHE_WRITE === 'true'
    : options.write

  const cachePath = process.env.SHADOWDOG_LOCAL_CACHE_PATH ?? options.path

  const currentCache = computeCache(files, environment, config.command)

  fs.mkdirpSync(cachePath)

  if (readCache) {
    const hasBeenRestored = await restoreCache(config, currentCache, {
      ...options,
      path: cachePath,
    })

    if (hasBeenRestored) {
      return abort()
    }
  }

  await next()

  if (writeCache) {
    return Promise.all(
      config.artifacts.map(async (artifact) => {
        const start = Date.now()
        const sourceCacheFilePath = path.join(process.cwd(), artifact.output)
        const exists = await fs.exists(sourceCacheFilePath)

        if (!exists) {
          logMessage(
            `📦 Not able to store artifact '${chalk.blue(
              artifact.output,
            )}' in cache because is not present`,
          )
          return
        }

        const cacheFileName = computeFileCacheName(currentCache, artifact.output)

        const cacheFilePath = path.join(cachePath, `${cacheFileName}.tar.gz`)
        const seconds = ((Date.now() - start) / 1000).toFixed(2)

        logMessage(
          `📦 Storing artifact '${chalk.blue(artifact.output)}' in cache with value '${chalk.green(
            cacheFileName,
          )}' ${chalk.cyan(`(${seconds}s)`)}`,
        )

        try {
          await compressArtifact(sourceCacheFilePath, cacheFilePath, (filePath) =>
            filterFn(artifact.ignore, artifact.output, filePath),
          )
        } catch (error: unknown) {
          logMessage(
            `🚫 An error ocurred while storing cache for artifact '${
              artifact.output
            }' with id '${chalk.green(cacheFileName)}'`,
          )
          logError(error as Error)
        }
      }),
    ).catch((error) => {
      logError(error as Error)
    })
  }
}

export default {
  middleware,
}
