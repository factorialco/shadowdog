/* Credit to claude AI for this algorithm

Given an array of objects that satisfies the DependencyObject interface, build a dependency graph and
return a structure that groups objects by level and provides connections between nodes.

"files" are the list of files that the object depends on, and "artifacts" are the list of files that the object produces.
They are strings, but could be whatever, this algorithm only needs to compare them by equality.
 */

// Define the base object structure
export interface DependencyObject {
  files?: string[]
  artifacts?: string[]
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
    // First, create nodes and build artifact index
    const artifactIndex = new Map<string, T>()

    for (const obj of objects) {
      this.addNode(obj)
      for (const artifact of obj.artifacts || []) {
        artifactIndex.set(artifact, obj)
      }
    }

    // Then, establish dependencies
    for (const obj of objects) {
      const node = this.nodes.get(obj)!

      for (const file of obj.files || []) {
        const dependencyObj = artifactIndex.get(file)
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
