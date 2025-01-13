import * as crypto from 'crypto'
import * as glob from 'glob'
import * as minio from 'minio'
import * as zlib from 'zlib'
import * as tar from 'tar'
import fs from 'fs-extra'
import chalk from 'chalk'
import path from 'path'
import { execSync } from 'child_process'
import { z } from 'zod'

import { ArtifactConfig } from '../config'
import { CommandConfig } from '../config'
import { logError, logMessage } from '../utils'
import { Middleware } from '.'

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
      // TODO: review this
      committer: process.env.GIT_COMMITTER_NAME ?? '',
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
  try {
    const stream = await client.getObject(bucket, objectName)

    console.log('DEBUG: decompressing in remote cache with tar')

    stream.pipe(
      tar.extract({
        cwd: path.join(process.cwd(), artifact.output, '..'),
        filter: (filePath) => filterFn(artifact.ignore, artifact.output, filePath),
      }),
    )
  } catch (error) {
    logMessage(
      `🌐 Not able to restore artifact '${chalk.blue(artifact.output)}' -> '${chalk.green(
        objectName,
      )}' in remote cache`,
    )
    logError(error as Error)

    return false
  }

  return true
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

const restoreCache = async (
  client: minio.Client,
  commandConfig: CommandConfig,
  currentCache: string,
  pluginOptions: PluginOptions,
) => {
  // Check if we can reuse some artifacts from the cache
  const promisesToGenerate = commandConfig.artifacts.map(async (artifact) => {
    const cacheFileName = computeFileCacheName(currentCache, artifact.output)

    const cacheFilePath = path.join(pluginOptions.path, `${cacheFileName}.tar.gz`)

    const restored = await restoreRemoteCache(
      client,
      pluginOptions.bucketName,
      cacheFilePath,
      artifact,
    )

    if (restored) {
      logMessage(
        `🌐 Reusing artifact '${chalk.blue(artifact.output)}' with id '${chalk.green(
          cacheFileName,
        )}' from remote cache because of cache ${chalk.bgGreen('HIT')}`,
      )

      return null
    }

    logMessage(
      `🌐 Not able to reuse artifact '${chalk.blue(
        artifact.output,
      )}' from remote cache because of cache ${chalk.bgRed('MISS')}`,
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
      )}' generation because all artifacts were reused from remote cache`,
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

const pluginOptionsSchema = z
  .object({ bucketName: z.string(), path: z.string().default('shadowdog/cache') })
  .strict()

type PluginOptions = z.infer<typeof pluginOptionsSchema>

const middleware: Middleware<PluginOptions> = async ({
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

  const mergedOptions = pluginOptionsSchema.parse(options)

  const client = createClient()

  if (!client) {
    return await next()
  }

  const currentCache = computeCache([...files, ...invalidators.files], invalidators.environment)

  const hasBeenRestored = await restoreCache(client, config, currentCache, mergedOptions)

  if (hasBeenRestored) {
    return abort()
  }

  await next()

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
      const cacheFilePath = path.join(mergedOptions.path, `${cacheFileName}.tar.gz`)
      const sourceCacheFilePath = path.join(process.cwd(), artifact.output)

      try {
        console.log('DEBUG: compressing in remote cache with tar')

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

        await saveRemoteCache(client, mergedOptions.bucketName, stream, cacheFilePath, artifact)
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

export default {
  middleware,
}
