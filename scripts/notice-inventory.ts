type DependencyTree = {
  path?: string
  dependencies?: Record<string, DependencyTree>
  optionalDependencies?: Record<string, DependencyTree>
}

/** Use pnpm's dependency tree, retaining distinct versions installed under aliases. */
export function productionPackagePaths(trees: DependencyTree[]): string[] {
  const paths = new Set<string>()
  function visit(node: DependencyTree) {
    for (const group of [node.dependencies, node.optionalDependencies])
      for (const dependency of Object.values(group ?? {})) {
        if (dependency.path) paths.add(dependency.path)
        // A deduplicated occurrence can precede the occurrence with children.
        visit(dependency)
      }
  }
  for (const tree of trees) visit(tree)
  return [...paths].sort()
}
