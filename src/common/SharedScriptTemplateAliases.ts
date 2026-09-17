import ts from 'typescript'

export function getSharedScriptCodeExportNames(source: string) {
  const names = new Set<string>()
  const sourceFile = ts.createSourceFile('shared-script.ts', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && hasExportModifier(statement) && !hasDefaultModifier(statement)) {
      names.add(statement.name.text)
      continue
    }

    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        collectBindingNames(declaration.name, names)
      }
      continue
    }

    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        if (!element.isTypeOnly) {
          names.add(element.name.text)
        }
      }
    }
  }

  return Array.from(names)
}

function hasExportModifier(node: ts.Node) {
  return ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) === true
}

function hasDefaultModifier(node: ts.Node) {
  return ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword) === true
}

function collectBindingNames(name: ts.BindingName, names: Set<string>) {
  if (ts.isIdentifier(name)) {
    names.add(name.text)
    return
  }

  for (const element of name.elements) {
    if (ts.isBindingElement(element)) {
      collectBindingNames(element.name, names)
    }
  }
}
