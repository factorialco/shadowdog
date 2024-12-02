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
        invalidators: {
          environment: [],
          files: [],
        },
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
        invalidators: {
          environment: [],
          files: [],
        },
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
        invalidators: {
          environment: [],
          files: [],
        },
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
            invalidators: {
              environment: [],
              files: [],
            },
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
            invalidators: {
              environment: [],
              files: [],
            },
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
            invalidators: {
              environment: [],
              files: [],
            },
          },
        ],
      },
    ],
  })
})
