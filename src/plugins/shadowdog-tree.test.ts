import { it, expect } from 'vitest'
import shadowdogTree from './shadowdog-tree'
import { Task } from '../generate'

it('shadowdog tree organize tasks with dependencies in serial tasks', () => {
  const task: Task = {
    type: 'parallel',
    tasks: [
      {
        type: 'command',
        config: {
          command: 'echo first',
          artifacts: [
            {
              output: 'first.artifact',
            },
          ],
          tags: [],
          workingDirectory: '',
        },
        files: [],
        environment: [],
      },
      {
        type: 'command',
        config: {
          command: 'echo second',
          artifacts: [
            {
              output: 'second.artifact',
            },
          ],
          tags: [],
          workingDirectory: '',
        },
        files: ['first.artifact'],
        environment: [],
      },
      {
        type: 'command',
        config: {
          command: 'echo third',
          artifacts: [
            {
              output: 'third.artifact',
            },
          ],
          tags: [],
          workingDirectory: '',
        },
        files: ['second.artifact'],
        environment: [],
      },
    ],
  }

  expect(shadowdogTree.command(task)).toEqual({
    type: 'serial',
    tasks: [
      {
        type: 'parallel',
        tasks: [
          {
            type: 'command',
            config: {
              command: 'echo first',
              artifacts: [
                {
                  output: 'first.artifact',
                },
              ],
              tags: [],
              workingDirectory: '',
            },
            files: [],
            environment: [],
          },
        ],
      },
      {
        type: 'parallel',
        tasks: [
          {
            type: 'command',
            config: {
              command: 'echo second',
              artifacts: [
                {
                  output: 'second.artifact',
                },
              ],
              tags: [],
              workingDirectory: '',
            },
            files: ['first.artifact'],
            environment: [],
          },
        ],
      },
      {
        type: 'parallel',
        tasks: [
          {
            type: 'command',
            config: {
              command: 'echo third',
              artifacts: [
                {
                  output: 'third.artifact',
                },
              ],
              tags: [],
              workingDirectory: '',
            },
            files: ['second.artifact'],
            environment: [],
          },
        ],
      },
    ],
  })
})
