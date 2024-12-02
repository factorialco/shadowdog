import chalk from 'chalk'
import { Command } from '.'
import { logMessage } from '../utils'
import { Task } from '../generate'

const filterTags = (task: Task, tag: string): Task => {
  switch (task.type) {
    case 'parallel': {
      return { ...task, tasks: task.tasks.map((subTask) => filterTags(subTask, tag)) }
    }
    case 'serial': {
      return { ...task, tasks: task.tasks.map((subTask) => filterTags(subTask, tag)) }
    }
    case 'command': {
      if (task.config.tags.includes(tag)) {
        return task
      }

      return { type: 'empty' }
    }
    case 'empty': {
      return task
    }
  }
}

const command: Command = (task) => {
  const tag = process.env.SHADOWDOG_TAG

  if (!tag) {
    return task
  }

  logMessage(`🏷️  Filtering commands by tag: ${chalk.green(tag)}`)

  return filterTags(task, tag)
}

export default {
  command,
}
