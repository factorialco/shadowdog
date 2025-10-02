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

it('shadowdog tree preserves dependency chain even when intermediate files do not exist', () => {
  // This test simulates the real-world scenario where backend/resources.json doesn't exist
  // but is needed as a dependency for the second command
  const task: Task = {
    type: 'parallel',
    tasks: [
      {
        type: 'command',
        config: {
          command: 'cd backend && bundle exec rake resource_registry:generate_cache',
          artifacts: [
            {
              output: 'backend/resources.json',
            },
          ],
          tags: [],
          workingDirectory: '',
        },
        files: ['backend/lib/resource_registry/catalog.rb'], // Some existing file
        environment: [],
      },
      {
        type: 'command',
        config: {
          command: 'cd backend && bundle exec rake autodiscovery:generate_graphql_schema',
          artifacts: [
            {
              output: 'backend/schema.graphql',
            },
          ],
          tags: [],
          workingDirectory: '',
        },
        files: ['backend/resources.json'], // This file doesn't exist but should be preserved for dependency tracking
        environment: [],
      },
      {
        type: 'command',
        config: {
          command: 'cd frontend && pnpm graphql-codegen',
          artifacts: [
            {
              output: 'frontend/src/generated/resources',
            },
          ],
          tags: [],
          workingDirectory: '',
        },
        files: ['backend/schema.graphql'], // This file also doesn't exist but should be preserved
        environment: [],
      },
    ],
  }

  const result = shadowdogTree.command(task)

  expect(result.type).toBe('serial')
  if (result.type === 'serial') {
    expect(result.tasks).toHaveLength(3) // Should have 3 layers

    // Verify the correct dependency order
    expect(result.tasks[0].type).toBe('parallel')
    if (result.tasks[0].type === 'parallel') {
      expect(result.tasks[0].tasks).toHaveLength(1)
      const firstTask = result.tasks[0].tasks[0]
      if (firstTask.type === 'command') {
        expect(firstTask.config.command).toContain('resource_registry:generate_cache')
      }
    }

    expect(result.tasks[1].type).toBe('parallel')
    if (result.tasks[1].type === 'parallel') {
      expect(result.tasks[1].tasks).toHaveLength(1)
      const secondTask = result.tasks[1].tasks[0]
      if (secondTask.type === 'command') {
        expect(secondTask.config.command).toContain('autodiscovery:generate_graphql_schema')
      }
    }

    expect(result.tasks[2].type).toBe('parallel')
    if (result.tasks[2].type === 'parallel') {
      expect(result.tasks[2].tasks).toHaveLength(1)
      const thirdTask = result.tasks[2].tasks[0]
      if (thirdTask.type === 'command') {
        expect(thirdTask.config.command).toContain('pnpm graphql-codegen')
      }
    }
  }
})
