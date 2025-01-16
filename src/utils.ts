import chalk from 'chalk'
import fs from 'fs'

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
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'))
  return packageJson.version
}
