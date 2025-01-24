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
