import { Command } from '.'
import { CommandConfig } from '../config'
import { CommandTask, EmptyTask, Task, ParallelTask } from '../generate'

const RAKE_COMMAND_REGEX = /^bundle exec rake (.*)$/

const filterCommandTasks = (tasks: Task[]) => {
  return tasks.reduce<{
    commandTasks: CommandTask[]
    otherTasks: Task[]
  }>(
    (acc, task) => {
      if (task.type === 'command') {
        acc.commandTasks.push(task)
      } else {
        acc.otherTasks.push(task)
      }

      return acc
    },
    { commandTasks: [], otherTasks: [] },
  )
}

const filterRakeTasks = (tasks: CommandTask[]) => {
  return tasks.reduce<{
    rakeTasks: CommandTask[]
    nonRakeTasks: CommandTask[]
  }>(
    (acc, task) => {
      if (task.config.command.match(RAKE_COMMAND_REGEX)) {
        acc.rakeTasks.push(task)
      } else {
        acc.nonRakeTasks.push(task)
      }

      return acc
    },
    { rakeTasks: [], nonRakeTasks: [] },
  )
}

const collapseRakeTasks = (tasks: CommandTask[]): ParallelTask | EmptyTask => {
  if (tasks.length === 0) {
    return { type: 'empty' }
  }

  const tasksByWorkingDirectory = tasks.reduce<Record<string, CommandTask[]>>((acc, task) => {
    const workingDirectory = task.config.workingDirectory

    if (!acc[workingDirectory]) {
      acc[workingDirectory] = []
    }

    acc[workingDirectory].push(task)
    return acc
  }, {})

  return {
    type: 'parallel',
    tasks: Object.entries(tasksByWorkingDirectory).map(
      ([workingDirectory, tasksInWorkingDirectory]) => {
        const config: CommandConfig = {
          artifacts: tasksInWorkingDirectory.flatMap((watcher) => watcher.config.artifacts),
          command: `bundle exec rake ${tasksInWorkingDirectory
            .map((watcher) => watcher.config.command.match(RAKE_COMMAND_REGEX)![1])
            .join(' ')}`,
          workingDirectory,
          tags: tasksInWorkingDirectory.flatMap((watcher) => watcher.config.tags),
        }

        return {
          type: 'command',
          config,
          files: tasksInWorkingDirectory.flatMap((watcher) => watcher.files),
          invalidators: {
            files: tasksInWorkingDirectory.flatMap((watcher) => watcher.invalidators.files),
            environment: tasksInWorkingDirectory.flatMap(
              (watcher) => watcher.invalidators.environment,
            ),
          },
        }
      },
    ),
  }
}

const command: Command = (task) => {
  switch (task.type) {
    case 'serial': {
      return { type: 'serial', tasks: task.tasks.map(command) }
    }
    case 'parallel': {
      const { commandTasks, otherTasks } = filterCommandTasks(task.tasks)
      const { rakeTasks, nonRakeTasks } = filterRakeTasks(commandTasks)
      const finalRakeTask = collapseRakeTasks(rakeTasks)

      return { ...task, tasks: [...otherTasks, ...nonRakeTasks, finalRakeTask] }
    }
    default:
      return task
  }
}

export default {
  command,
}
