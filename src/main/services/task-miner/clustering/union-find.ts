/** Union-find with path compression and union by size. */
export class UnionFind {
  private readonly parent: number[]
  private readonly size: number[]

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i)
    this.size = new Array<number>(n).fill(1)
  }

  find(i: number): number {
    let root = i
    while (this.parent[root] !== root) root = this.parent[root]
    while (this.parent[i] !== root) {
      const next = this.parent[i]
      this.parent[i] = root
      i = next
    }
    return root
  }

  union(a: number, b: number): void {
    const rootA = this.find(a)
    const rootB = this.find(b)
    if (rootA === rootB) return
    if (this.size[rootA] < this.size[rootB]) {
      this.parent[rootA] = rootB
      this.size[rootB] += this.size[rootA]
    } else {
      this.parent[rootB] = rootA
      this.size[rootA] += this.size[rootB]
    }
  }

  /** Connected components as lists of member indices, in first-seen order. */
  components(): number[][] {
    const byRoot = new Map<number, number[]>()
    for (let i = 0; i < this.parent.length; i++) {
      const root = this.find(i)
      const members = byRoot.get(root)
      if (members) members.push(i)
      else byRoot.set(root, [i])
    }
    return [...byRoot.values()]
  }
}
