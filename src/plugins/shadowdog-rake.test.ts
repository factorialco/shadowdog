import { it, expect } from 'vitest'
import shadowdogRake from './shadowdog-rake'
import { Task } from '../generate'

it('shadowdog rake joins rake tasks from the same working directory', () => {
  const task: Task = {
    type: 'parallel',
    tasks: [
      {
        type: 'command',
        config: {
          command: 'bundle exec rake first',
          artifacts: [],
          tags: [],
          workingDirectory: 'backend',
        },
        files: [],
        environment: [],
      },
      {
        type: 'command',
        config: {
          command: 'echo non rake task',
          artifacts: [],
          tags: [],
          workingDirectory: 'backend',
        },
        files: [],
        environment: [],
      },
      {
        type: 'command',
        config: {
          command: 'bundle exec rake second',
          artifacts: [],
          tags: [],
          workingDirectory: 'backend',
        },
        files: [],
        environment: [],
      },
    ],
  }

  expect(shadowdogRake.command(task)).toEqual({
    type: 'parallel',
    tasks: [
      {
        type: 'command',
        config: {
          command: 'echo non rake task',
          artifacts: [],
          tags: [],
          workingDirectory: 'backend',
        },
        files: [],
        environment: [],
      },
      {
        type: 'parallel',
        tasks: [
          {
            type: 'command',
            config: {
              command: 'bundle exec rake first second',
              artifacts: [],
              tags: [],
              workingDirectory: 'backend',
            },
            files: [],
            environment: [],
          },
        ],
      },
    ],
  })
})

it('shadowdog rake joins rake tasks from different working directories', () => {
  const task: Task = {
    type: 'parallel',
    tasks: [
      {
        type: 'command',
        config: {
          command: 'bundle exec rake first',
          artifacts: [],
          tags: [],
          workingDirectory: 'backend',
        },
        files: [],
        environment: [],
      },
      {
        type: 'command',
        config: {
          command: 'bundle exec rake third',
          artifacts: [],
          tags: [],
          workingDirectory: 'graphql-server',
        },
        files: [],
        environment: [],
      },
      {
        type: 'command',
        config: {
          command: 'echo non rake task',
          artifacts: [],
          tags: [],
          workingDirectory: 'backend',
        },
        files: [],
        environment: [],
      },
      {
        type: 'command',
        config: {
          command: 'bundle exec rake second',
          artifacts: [],
          tags: [],
          workingDirectory: 'backend',
        },
        files: [],
        environment: [],
      },
    ],
  }

  expect(shadowdogRake.command(task)).toEqual({
    type: 'parallel',
    tasks: [
      {
        type: 'command',
        config: {
          command: 'echo non rake task',
          artifacts: [],
          tags: [],
          workingDirectory: 'backend',
        },
        files: [],
        environment: [],
      },
      {
        type: 'parallel',
        tasks: [
          {
            type: 'command',
            config: {
              command: 'bundle exec rake first second',
              artifacts: [],
              tags: [],
              workingDirectory: 'backend',
            },
            files: [],
            environment: [],
          },
          {
            type: 'command',
            config: {
              command: 'bundle exec rake third',
              artifacts: [],
              tags: [],
              workingDirectory: 'graphql-server',
            },
            files: [],
            environment: [],
          },
        ],
      },
    ],
  })
})
