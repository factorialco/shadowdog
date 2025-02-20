import chalk from 'chalk'
import { execSync } from 'child_process'
import fs from 'fs-extra'
import * as minio from 'minio'
import path from 'path'
import * as tar from 'tar'
import * as zlib from 'zlib'

import { Middleware } from '.'
import { ArtifactConfig, CommandConfig } from '../config'
import { PluginConfig } from '../pluginTypes'
import { computeCache, computeFileCacheName, logError, logMessage } from '../utils'

const createClient = () => {
  const { AWS_PROFILE } = process.env

  if (AWS_PROFILE) {
    try {
      const credentials = JSON.parse(
        execSync(`aws configure export-credentials --profile "${AWS_PROFILE}"`).toString(),
      )

      return new minio.Client({
        endPoint: 's3.amazonaws.com',
        useSSL: true,
        accessKey: credentials.AccessKeyId,
        secretKey: credentials.SecretAccessKey,
        sessionToken: credentials.SessionToken,
        region: execSync(`aws configure get region --profile "${AWS_PROFILE}"`).toString().trim(),
      })
    } catch {
      logMessage(
        `🌐 Not able to create a client for remote cache because of failing authentication with AWS_PROFILE`,
      )
      return null
    }
  }

  const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION } = process.env

  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY || !AWS_REGION) {
    logMessage(`🌐 Not able to create a client for remote cache because of missing AWS credentials`)
    return null
  }

  return new minio.Client({
    endPoint: 's3.amazonaws.com',
    useSSL: true,
    accessKey: AWS_ACCESS_KEY_ID,
    secretKey: AWS_SECRET_ACCESS_KEY,
    region: AWS_REGION,
  })
}

const saveRemoteCache = async (
  client: minio.Client,
  bucket: string,
  stream: fs.ReadStream | zlib.Gzip,
  objectName: string,
  artifact: ArtifactConfig,
) => {
  try {
    await client.putObject(bucket, objectName, stream, stream.readableLength, {
      output: artifact.output,
      extra: process.env.SHADOWDOG_REMOTE_CACHE_EXTRA ?? '',
    })
  } catch (error) {
    logMessage(
      `🌐 Not able to store artifact '${chalk.blue(artifact.output)}' -> '${chalk.green(
        objectName,
      )}' in remote cache`,
    )

    logError(error as Error)

    return false
  }

  return true
}

const restoreRemoteCache = async (
  client: minio.Client,
  bucket: string,
  objectName: string,
  artifact: ArtifactConfig,
) => {
  const stream = await client.getObject(bucket, objectName)
  const outputPath = path.join(process.cwd(), artifact.output, '..')

  fs.mkdirpSync(outputPath)

  return new Promise((resolve, reject) => {
    const extractStream = stream.pipe(
      tar.extract({
        cwd: outputPath,
        filter: (filePath) => filterFn(artifact.ignore, artifact.output, filePath),
      }),
    )

    extractStream.on('end', () => {
      resolve(null)
    })

    extractStream.on('error', reject)
  })
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

const restoreCache = async (
  client: minio.Client,
  commandConfig: CommandConfig,
  currentCache: string,
  pluginOptions: PluginConfig<'shadowdog-remote-aws-s3-cache'>,
) => {
  // Check if we can reuse some artifacts from the cache
  const promisesToGenerate = commandConfig.artifacts.map(async (artifact) => {
    const cacheFileName = computeFileCacheName(currentCache, artifact.output)

    const cacheFilePath = path.join(pluginOptions.path, `${cacheFileName}.tar.gz`)

    try {
      await restoreRemoteCache(client, pluginOptions.bucketName, cacheFilePath, artifact)

      logMessage(
        `🌐 Reusing artifact '${chalk.blue(artifact.output)}' with id '${chalk.green(
          cacheFileName,
        )}' from remote cache because of cache ${chalk.bgGreen('HIT')}`,
      )

      return null
    } catch (error) {
      logMessage(
        `🌐 Not able to reuse artifact '${chalk.blue(artifact.output)}' with id '${chalk.green(
          cacheFileName,
        )}' from remote cache because of cache ${chalk.bgRed('MISS')}`,
      )

      logError(error as Error)
    }

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
      )}' generation because all artifacts were reused from remote cache`,
    )

    return true
  }

  return false
}

const middleware: Middleware<PluginConfig<'shadowdog-remote-aws-s3-cache'>> = async ({
  config,
  files,
  invalidators,
  next,
  abort,
  options,
}) => {
  if (process.env.SHADOWDOG_DISABLE_REMOTE_CACHE) {
    return next()
  }

  const client = createClient()

  if (!client) {
    return await next()
  }

  const readCache = process.env.SHADOWDOG_REMOTE_CACHE_READ
    ? process.env.SHADOWDOG_REMOTE_CACHE_READ === 'true'
    : options.read

  const writeCache = process.env.SHADOWDOG_REMOTE_CACHE_WRITE
    ? process.env.SHADOWDOG_REMOTE_CACHE_WRITE === 'true'
    : options.write

  const currentCache = computeCache([...files, ...invalidators.files], invalidators.environment)

  if (readCache) {
    const hasBeenRestored = await restoreCache(client, config, currentCache, options)

    if (hasBeenRestored) {
      return abort()
    }
  }

  await next()

  if (writeCache) {
    return Promise.all(
      config.artifacts.map(async (artifact) => {
        if (!fs.existsSync(path.join(process.cwd(), artifact.output))) {
          logMessage(
            `🌐 Not able to store artifact '${chalk.blue(
              artifact.output,
            )}' in remote cache because is not present`,
          )
          return
        }

        const cacheFileName = computeFileCacheName(currentCache, artifact.output)
        const cacheFilePath = path.join(options.path, `${cacheFileName}.tar.gz`)
        const sourceCacheFilePath = path.join(process.cwd(), artifact.output)

        try {
          const tarStream = tar.create(
            {
              gzip: false,
              cwd: path.dirname(sourceCacheFilePath),
              filter: (filePath) => filterFn(artifact.ignore, artifact.output, filePath),
            },
            [path.basename(sourceCacheFilePath)],
          )

          tarStream.on('error', (error) => {
            logError(error as Error)
          })

          const gzipStream = zlib.createGzip()

          gzipStream.on('error', (error) => {
            logError(error as Error)
          })

          const stream = tarStream.pipe(gzipStream)

          stream.on('error', (error) => {
            logError(error as Error)
          })

          logMessage(
            `🌐 Storing artifact '${chalk.blue(
              artifact.output,
            )}' in remote cache with value '${chalk.green(cacheFileName)}'`,
          )

          await saveRemoteCache(client, options.bucketName, stream, cacheFilePath, artifact)
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
      logError(error)
    })
  }
}

export default {
  middleware,
}
