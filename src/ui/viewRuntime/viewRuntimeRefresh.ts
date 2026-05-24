import ts from 'typescript'

export function transformViewRuntimeSource(source: string, moduleId: string) {
  const sourceFile = ts.createSourceFile('view-runtime-refresh.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const factory = ts.factory
  const statements: ts.Statement[] = []

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && isLikelyRefreshComponentName(statement.name.text)) {
      statements.push(...transformFunctionComponentDeclaration(statement, moduleId, factory))
      continue
    }

    if (ts.isVariableStatement(statement)) {
      statements.push(transformVariableStatement(statement, moduleId, factory))
      continue
    }

    statements.push(statement)
  }

  const transformedSourceFile = factory.updateSourceFile(sourceFile, statements)
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
  return printer.printFile(transformedSourceFile)
}

export function isLikelyRefreshComponentName(value: string) {
  return /^[A-Z]/u.test(value)
}

function transformFunctionComponentDeclaration(
  statement: ts.FunctionDeclaration,
  moduleId: string,
  factory: typeof ts.factory
) {
  const name = statement.name?.text
  if (!name) {
    return [statement]
  }

  const isDefaultExport = statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword) ?? false
  const isNamedExport = statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
  const wrapped = factory.createVariableStatement(
    isNamedExport && !isDefaultExport ? [factory.createModifier(ts.SyntaxKind.ExportKeyword)] : undefined,
    factory.createVariableDeclarationList(
      [
        factory.createVariableDeclaration(
          factory.createIdentifier(name),
          undefined,
          undefined,
          createHotRegistrationCall(moduleId, name, factory.createFunctionExpression(
            undefined,
            undefined,
            factory.createIdentifier(name),
            statement.typeParameters,
            statement.parameters,
            statement.type,
            statement.body ?? factory.createBlock([], false)
          ), factory)
        ),
      ],
      ts.NodeFlags.Const
    )
  )

  if (!isDefaultExport) {
    return [wrapped]
  }

  return [
    wrapped,
    factory.createExportDefault(factory.createIdentifier(name)),
  ]
}

function transformVariableStatement(
  statement: ts.VariableStatement,
  moduleId: string,
  factory: typeof ts.factory
) {
  const declarations = statement.declarationList.declarations.map(declaration => {
    if (!ts.isIdentifier(declaration.name) || !isLikelyRefreshComponentName(declaration.name.text)) {
      return declaration
    }

    const initializer = declaration.initializer
    if (!initializer || (!ts.isArrowFunction(initializer) && !ts.isFunctionExpression(initializer))) {
      return declaration
    }

    return factory.updateVariableDeclaration(
      declaration,
      declaration.name,
      declaration.exclamationToken,
      declaration.type,
      createHotRegistrationCall(moduleId, declaration.name.text, initializer, factory)
    )
  })

  return factory.updateVariableStatement(
    statement,
    statement.modifiers,
    factory.updateVariableDeclarationList(statement.declarationList, declarations)
  )
}

function createHotRegistrationCall(
  moduleId: string,
  name: string,
  initializer: ts.Expression,
  factory: typeof ts.factory
) {
  return factory.createCallExpression(factory.createIdentifier('__registerHotComponent'), undefined, [
    factory.createStringLiteral(`${moduleId}:${name}`),
    initializer,
  ])
}
