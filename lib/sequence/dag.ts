import { CircularDependencyError } from '../errors'
import type { Step, Gate, Sequence } from './schema'

type Node = Step | Gate

/**
 * Validate that the sequence has no circular dependencies.
 * Uses DFS with recursion stack for cycle detection.
 *
 * @param sequence - The sequence to validate
 * @throws CircularDependencyError if a cycle is detected
 */
export function validateDAG(sequence: Sequence): void {
  const nodes = new Map<string, Node>()

  for (const step of sequence.steps) {
    nodes.set(step.id, step)
  }
  for (const gate of sequence.gates) {
    nodes.set(gate.id, gate)
  }

  // Detect cycles using DFS with recursion stack
  const visited = new Set<string>()
  const recursionStack = new Set<string>()

  function dfs(nodeId: string, path: string[]): void {
    if (recursionStack.has(nodeId)) {
      const cycleStart = path.indexOf(nodeId)
      throw new CircularDependencyError([...path.slice(cycleStart), nodeId])
    }

    if (visited.has(nodeId)) return

    visited.add(nodeId)
    recursionStack.add(nodeId)

    const node = nodes.get(nodeId)
    if (!node) return

    for (const depId of node.depends_on) {
      dfs(depId, [...path, nodeId])
    }

    recursionStack.delete(nodeId)
  }

  for (const nodeId of nodes.keys()) {
    dfs(nodeId, [])
  }
}

/** Build a node map and initialize in-degrees from a sequence */
function buildNodeGraph(sequence: Sequence): { nodes: Map<string, Node>; inDegree: Map<string, number> } {
  const nodes = new Map<string, Node>()
  const inDegree = new Map<string, number>()

  for (const step of sequence.steps) {
    nodes.set(step.id, step)
    inDegree.set(step.id, 0)
  }
  for (const gate of sequence.gates) {
    nodes.set(gate.id, gate)
    inDegree.set(gate.id, 0)
  }

  for (const node of nodes.values()) {
    for (const depId of node.depends_on) {
      if (nodes.has(depId)) {
        inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1)
      }
    }
  }

  return { nodes, inDegree }
}

/** Run Kahn's algorithm on pre-computed node graph */
function kahnSort(nodes: Map<string, Node>, inDegree: Map<string, number>): string[] {
  const queue: string[] = []
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id)
  }

  const result: string[] = []
  while (queue.length > 0) {
    const nodeId = queue.shift()!
    result.push(nodeId)

    for (const [id, n] of nodes) {
      if (n.depends_on.includes(nodeId)) {
        const newDegree = (inDegree.get(id) ?? 0) - 1
        inDegree.set(id, newDegree)
        if (newDegree === 0) queue.push(id)
      }
    }
  }

  return result
}

/**
 * Compute topological order for execution using Kahn's algorithm.
 * Returns nodes in order such that all dependencies come before dependents.
 *
 * @param sequence - The sequence to sort
 * @returns Array of node IDs in topological order
 */
export function topologicalSort(sequence: Sequence): string[] {
  const { nodes, inDegree } = buildNodeGraph(sequence)
  return kahnSort(nodes, inDegree)
}
