import chalk from 'chalk'

export const logMessage = (message: string) => {
  console.log(message)
}

export const chalkFiles = (files: string[]) =>
  files.map((file) => `'${chalk.blue(file)}'`).join(', ')
