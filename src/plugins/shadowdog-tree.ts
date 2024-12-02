import chalk from 'chalk'
import { Command } from '.'
import { CommandTask, Task } from '../generate'
import { logMessage } from '../utils'

/* Credit to claude AI for this algorithm

Given an array of objects that satisfies the DependencyObject interface, build a dependency graph and
return a structure that groups objects by level and provides connections between nodes.

"files" are the list of files that the object depends on, and "artifacts" are the list of files that the object produces.
They are strings, but could be whatever, this algorithm only needs to compare them by equality.
 */

// Define the base object structure
export interface DependencyObject {
  files: string[]
  outputs: string[]
}

// Node in the dependency graph
class DependencyNode<T extends DependencyObject> {
  object: T
  dependencies: Set<DependencyNode<T>>
  dependents: Set<DependencyNode<T>>

  constructor(object: T) {
    this.object = object
    this.dependencies = new Set()
    this.dependents = new Set()
  }
}

// Structure returned by getStructure()
interface GraphStructure<T extends DependencyObject> {
  byLevel: {
    [level: number]: Array<{
      object: T
      dependencies: T[]
      dependents: T[]
    }>
  }
  nodeConnections: {
    [key: string]: {
      dependencies: T[]
      dependents: T[]
    }
  }
}

export class DependencyGraph<T extends DependencyObject> {
  private nodes: Map<T, DependencyNode<T>>
  private levels: Map<number, Set<DependencyNode<T>>> | null

  constructor() {
    this.nodes = new Map()
    this.levels = null
  }

  private addNode(object: T): DependencyNode<T> {
    if (!this.nodes.has(object)) {
      this.nodes.set(object, new DependencyNode<T>(object))
    }
    return this.nodes.get(object)!
  }

  buildGraph(objects: T[]): DependencyGraph<T> {
    // First, create nodes and build output index
    const outputIndex = new Map<string, T>()

    for (const obj of objects) {
      this.addNode(obj)
      for (const output of obj.outputs || []) {
        outputIndex.set(output, obj)
      }
    }

    // Then, establish dependencies
    for (const obj of objects) {
      const node = this.nodes.get(obj)!

      for (const file of obj.files || []) {
        const dependencyObj = outputIndex.get(file)
        if (dependencyObj) {
          const dependencyNode = this.nodes.get(dependencyObj)!
          node.dependencies.add(dependencyNode)
          dependencyNode.dependents.add(node)
        }
      }
    }

    this.topologicalSort()
    return this
  }

  private topologicalSort(): void {
    const visited = new Set<DependencyNode<T>>()
    const temp = new Set<DependencyNode<T>>()
    const levels = new Map<DependencyNode<T>, number>()

    const visit = (node: DependencyNode<T>, level: number = 0): number => {
      if (temp.has(node)) {
        throw new Error('Circular dependency detected')
      }
      if (visited.has(node)) {
        return levels.get(node)!
      }

      temp.add(node)
      let maxChildLevel = level

      for (const dep of node.dependencies) {
        const childLevel = visit(dep, level + 1)
        maxChildLevel = Math.max(maxChildLevel, childLevel + 1)
      }

      temp.delete(node)
      visited.add(node)
      levels.set(node, maxChildLevel)
      return maxChildLevel
    }

    // Process all nodes
    for (const node of this.nodes.values()) {
      if (!visited.has(node)) {
        visit(node)
      }
    }

    // Group nodes by level
    this.levels = new Map()
    for (const [node, level] of levels) {
      if (!this.levels.has(level)) {
        this.levels.set(level, new Set())
      }
      this.levels.get(level)!.add(node)
    }
  }

  getStructure(): GraphStructure<T> {
    if (!this.levels) {
      throw new Error('Graph not built yet. Call buildGraph first.')
    }

    const structure: GraphStructure<T> = {
      byLevel: {},
      nodeConnections: {},
    }

    // Organize by levels
    for (const [level, nodes] of this.levels) {
      structure.byLevel[level] = Array.from(nodes).map((node) => ({
        object: node.object,
        dependencies: Array.from(node.dependencies).map((dep) => dep.object),
        dependents: Array.from(node.dependents).map((dep) => dep.object),
      }))
    }

    // Create node connections map
    for (const [obj, node] of this.nodes) {
      structure.nodeConnections[JSON.stringify(obj)] = {
        dependencies: Array.from(node.dependencies).map((dep) => dep.object),
        dependents: Array.from(node.dependents).map((dep) => dep.object),
      }
    }

    return structure
  }
}

interface TaskInDependencyGraphFormat extends DependencyObject {
  task: Task
}

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

/*
  Builds the dependency graph of watchers and returns the watchers in layers, in the order they
  need to run to satisfy the dependencies.

  This also detects circular dependencies and throws an error they're found.
   */
const organizeTasksInLayers = (tasks: Task[]): Task => {
  const { commandTasks, otherTasks } = filterCommandTasks(tasks)

  const tasksInDependencyFormat: TaskInDependencyGraphFormat[] = commandTasks.map((task) => {
    return {
      task,
      outputs: task.config.artifacts.map((artifact) => artifact.output),
      files: task.files,
    }
  })

  const graph = new DependencyGraph<TaskInDependencyGraphFormat>()
  const structure = graph.buildGraph(tasksInDependencyFormat).getStructure()
  const parallelTasks = Object.values(structure.byLevel).map<Task>((level) => ({
    type: 'parallel',
    tasks: level.map((node) => node.object.task),
  }))

  logMessage(`🌳 Building a command tree with ${chalk.cyan(parallelTasks.length)} layers.`)

  return {
    type: 'serial',
    tasks: [...parallelTasks, ...otherTasks],
  }
}

const command: Command = (task) => {
  switch (task.type) {
    case 'parallel': {
      return organizeTasksInLayers(task.tasks)
    }
    default: {
      return task
    }
  }
}

export default {
  command,
}
