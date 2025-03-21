import { CommandConfig, InvalidatorConfig } from './config'
import { ShadowdogEventEmitter } from './events'
import { Middleware } from './plugins'
import { Task } from './generate'

interface Options {
  files: string[]
  invalidators: InvalidatorConfig
  config: CommandConfig
  eventEmitter: ShadowdogEventEmitter
  changedFilePath?: string
  task?: Task
}

export class TaskRunner {
  middlewares: Array<{ middleware: Middleware; options: unknown; changedFilePath?: string }>

  constructor(private runnerOptions: Options) {
    this.middlewares = []
  }

  use(middleware: Middleware, options: unknown = {}) {
    this.middlewares.push({ middleware, options })
  }

  async execute() {
    let result: unknown = null
    let index = -1
    let isAborted = false

    const abort = () => {
      isAborted = true
    }

    const next = async () => {
      if (isAborted || ++index >= this.middlewares.length) return result
      const current = this.middlewares[index]
      return current.middleware({
        files: this.runnerOptions.files,
        invalidators: this.runnerOptions.invalidators,
        config: this.runnerOptions.config,
        eventEmitter: this.runnerOptions.eventEmitter,
        changedFilePath: this.runnerOptions.changedFilePath,
        options: current.options,
        next,
        abort,
        task: this.runnerOptions.task,
      })
    }

    result = await next()
    return result
  }
}
