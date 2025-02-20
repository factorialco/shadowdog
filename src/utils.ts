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

export const computeCache = (files: string[], environment: string[]) => {
  const hash = crypto.createHmac('sha1', '')

  files
    .map((file) => path.join(process.cwd(), file))
    .flatMap((globPath) => glob.sync(globPath))
    .filter((filePath) => fs.statSync(filePath).isFile())
    .sort()
    .forEach((filePath) => hash.update(fs.readFileSync(filePath, 'utf-8')))

  environment.forEach((env) => hash.update(process.env[env] ?? ''))

  hash.update(readShadowdogVersion())

  return hash.digest('hex').slice(0, 10)
}

export const computeFileCacheName = (currentCache: string, fileName: string) => {
  const hash = crypto.createHmac('sha1', '')

  hash.update(currentCache)
  hash.update(fileName)
  hash.update(readShadowdogVersion())

  return hash.digest('hex').slice(0, 10)
}
