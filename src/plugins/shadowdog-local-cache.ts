import * as crypto from 'crypto'
import * as glob from 'glob'
import * as fs from 'fs-extra'
import * as path from 'path'
import * as tar from 'tar'
import * as zlib from 'zlib'

import chalk from 'chalk'
import { z } from 'zod'
import { Middleware } from '.'
import { CommandConfig } from '../config'
import { logMessage, logError } from '../utils'

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

    tarStream.pipe(gzipStream).pipe(writeStream)

    writeStream.on('finish', () => {
      resolve(null)
    })
    writeStream.on('error', (err) => {
      reject(err)
    })
  })
}

const decompressArtifact = (tarGzPath: string, outputPath: string, filter: FilterFn) => {
  return new Promise((resolve, reject) => {
    fs.mkdirpSync(outputPath)

    const readStream = fs.createReadStream(tarGzPath)
    const unzipStream = zlib.createGunzip()
    const tarExtractStream = tar.x({ cwd: outputPath, filter })

    readStream.pipe(unzipStream).pipe(tarExtractStream)

    tarExtractStream.on('finish', () => {
      resolve(null)
    })
    tarExtractStream.on('error', (err) => {
      reject(err)
    })
    unzipStream.on('error', (err) => {
      reject(err)
    })
  })
}

const restoreCache = async (
  commandConfig: CommandConfig,
  currentCache: string,
  { path: cachePath }: PluginOptions,
) => {
  // Check if we can reuse some artifacts from the cache
  const promisesToGenerate = commandConfig.artifacts.map(async (artifact) => {
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
          )}' with id '${chalk.green(cacheFileName)}`,
        )
        logError(error as Error)

        return artifact
      }

      return null
    }

    logMessage(
      `📦 Not able to reuse artifact '${chalk.blue(
        artifact.output,
      )}' from cache because of cache ${chalk.bgRed('MISS')}`,
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

const computeCache = (files: string[], environment: string[]) => {
  const hash = crypto.createHmac('sha1', '')

  files
    .map((file) => path.join(process.cwd(), file))
    .flatMap((globPath) => glob.sync(globPath))
    .filter((filePath) => fs.statSync(filePath).isFile())
    .sort()
    .forEach((filePath) => hash.update(fs.readFileSync(filePath, 'utf-8')))

  environment.forEach((env) => hash.update(process.env[env] ?? ''))

  return hash.digest('hex').slice(0, 10)
}

const computeFileCacheName = (currentCache: string, fileName: string) => {
  const hash = crypto.createHmac('sha1', '')

  hash.update(currentCache)
  hash.update(fileName)

  return hash.digest('hex').slice(0, 10)
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

const pluginOptionsSchema = z.object({ path: z.string().default('/tmp/shadowdog/cache') }).strict()

type PluginOptions = z.infer<typeof pluginOptionsSchema>

const middleware: Middleware<PluginOptions> = async ({
  files,
  invalidators,
  config,
  next,
  abort,
  options,
}) => {
  if (process.env.SHADOWDOG_DISABLE_LOCAL_CACHE) {
    return next()
  }

  const mergedOptions = pluginOptionsSchema.parse(options)

  mergedOptions.path = process.env.SHADOWDOG_LOCAL_CACHE_PATH ?? mergedOptions.path

  const currentCache = computeCache([...files, ...invalidators.files], invalidators.environment)

  fs.mkdirpSync(mergedOptions.path)

  const hasBeenRestored = await restoreCache(config, currentCache, mergedOptions)

  if (hasBeenRestored) {
    return abort()
  }

  await next()

  return Promise.all(
    config.artifacts.map(async (artifact) => {
      if (!fs.existsSync(path.join(process.cwd(), artifact.output))) {
        logMessage(
          `📦 Not able to store artifact '${chalk.blue(
            artifact.output,
          )}' in cache because is not present`,
        )
        return
      }

      const cacheFileName = computeFileCacheName(currentCache, artifact.output)

      const cacheFilePath = path.join(mergedOptions.path, `${cacheFileName}.tar.gz`)

      logMessage(
        `📦 Storing artifact '${chalk.blue(artifact.output)}' in cache with value '${chalk.green(
          cacheFileName,
        )}'`,
      )

      const sourceCacheFilePath = path.join(process.cwd(), artifact.output)

      try {
        await compressArtifact(sourceCacheFilePath, cacheFilePath, (filePath) =>
          filterFn(artifact.ignore, artifact.output, filePath),
        )
      } catch (error: unknown) {
        logMessage(
          `🚫 An error ocurred while storing cache for artifact '${
            artifact.output
          }' with id '${chalk.green(cacheFileName)}`,
        )
        logError(error as Error)
      }
    }),
  ).catch((error) => {
    logError(error as Error)
  })
}

export default {
  middleware,
}
