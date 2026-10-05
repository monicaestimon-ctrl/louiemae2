import ts from 'typescript';

// Follow typed product writes through shared helpers to their mutation entry
// points. This catches an unwrapped new writer before it can make summaries stale.
const config = ts.readConfigFile('convex/tsconfig.json', ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, 'convex');
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();
const projectSource = source => !source.isDeclarationFile && !source.fileName.includes('node_modules')
  && !source.fileName.includes('.test.') && !source.fileName.includes('_generated');

function writesProducts(root, seen = new Set()) {
  if (seen.has(root)) return false;
  seen.add(root);
  let found = false;
  function visit(node) {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const first = node.arguments[0];
      if (first && ts.isPropertyAccessExpression(callee)
        && callee.expression.getText().endsWith('.db')) {
        const operation = callee.name.text;
        if (operation === 'insert' && ts.isStringLiteral(first) && first.text === 'products') found = true;
        if (['patch', 'replace', 'delete'].includes(operation)
          && checker.typeToString(checker.getTypeAtLocation(first)).includes('"products"')) found = true;
      }
      let symbol = checker.getSymbolAtLocation(callee);
      if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      for (const declaration of symbol?.declarations ?? []) {
        if (!projectSource(declaration.getSourceFile())) continue;
        const fn = ts.isFunctionDeclaration(declaration) ? declaration
          : ts.isVariableDeclaration(declaration) ? declaration.initializer : undefined;
        if (fn && (ts.isFunctionDeclaration(fn) || ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
          if (writesProducts(fn, seen)) found = true;
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(root);
  return found;
}

const violations = [];
let checked = 0;
for (const source of program.getSourceFiles()) {
  if (!projectSource(source)) continue;
  const builders = new Map();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const imports = statement.importClause?.namedBindings;
    if (!imports || !ts.isNamedImports(imports)) continue;
    for (const item of imports.elements) {
      if (['mutation', 'internalMutation'].includes((item.propertyName ?? item.name).text)) {
        builders.set(item.name.text, statement.moduleSpecifier.text);
      }
    }
  }
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const call = declaration.initializer;
      if (!call || !ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) continue;
      const builderSource = builders.get(call.expression.text);
      const definition = call.arguments[0];
      if (!builderSource || !definition || !ts.isObjectLiteralExpression(definition)) continue;
      const property = definition.properties.find(p => p.name?.getText(source) === 'handler');
      const handler = property && ts.isPropertyAssignment(property) ? property.initializer : property;
      if (!handler || !writesProducts(handler)) continue;
      checked++;
      if (builderSource !== './functions') violations.push(`${source.fileName}:${source.getLineAndCharacterOfPosition(declaration.getStart()).line + 1} ${declaration.name.getText(source)}`);
    }
  }
}
if (violations.length) {
  console.error(`Product writers missing transactional catalog maintenance:\n${violations.join('\n')}`);
  process.exitCode = 1;
} else console.log(`Catalog maintenance covers ${checked} typed product mutation entry points.`);
