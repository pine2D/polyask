import ts from 'typescript';

const comparisons = new Set(['equal', 'notEqual', 'strictEqual', 'notStrictEqual',
  'deepEqual', 'notDeepEqual', 'deepStrictEqual', 'notDeepStrictEqual']);
const domCalls = /^(querySelector(All)?|getElementById|getElementsBy\w+|createElement|closest|findComposer|sendBtn|historyTurn|button|choice|marked)$/;
const domProperties = /^(activeElement|ownerDocument|parentElement|firstElementChild|lastElementChild|user|answer|answerRoot)$/;
const scalarProperties = /^(length|size|value|checked|disabled|textContent|innerHTML|outerHTML|id|nodeType|nodeName|isConnected)$/;
const assertionModule = value => /^((node:)?assert)(\/strict)?$/.test(value ?? '');
const unwrap = node => {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node))) node = node.expression;
  return node;
};
function walk(node, visit) { visit(node); ts.forEachChild(node, child => walk(child, visit)); }

// 只分析 AST 中的实际调用，夹具/源码字符串不会被当作正在执行的断言。
export function checkDomAssertions(source, filename = 'test.tsx') {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const assertions = new Set(), named = new Set(), aliases = new Set();
  walk(file, node => {
    if (ts.isImportDeclaration(node) && assertionModule(node.moduleSpecifier.text)) {
      const clause = node.importClause;
      if (clause?.name) assertions.add(clause.name.text);
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) assertions.add(clause.namedBindings.name.text);
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const item of clause.namedBindings.elements) {
          if (comparisons.has(item.propertyName?.text ?? item.name.text)) named.add(item.name.text);
        }
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
      ts.isCallExpression(node.initializer) && node.initializer.expression.getText(file) === 'require' &&
      assertionModule(node.initializer.arguments[0]?.text)) assertions.add(node.name.text);
  });
  function isDom(node) {
    node = unwrap(node);
    if (!node) return false;
    if (ts.isIdentifier(node)) return aliases.has(node.text);
    if (ts.isPropertyAccessExpression(node)) {
      if (scalarProperties.test(node.name.text)) return false;
      return domProperties.test(node.name.text);
    }
    if (ts.isCallExpression(node)) {
      const fn = unwrap(node.expression);
      const name = ts.isPropertyAccessExpression(fn) ? fn.name.text : fn.getText(file);
      const answerNode = ts.isPropertyAccessExpression(fn) && name === 'answer' && fn.expression.getText(file) !== 'session';
      return domCalls.test(name) || answerNode || aliases.has(name);
    }
    if (ts.isBinaryExpression(node)) {
      return [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken]
        .includes(node.operatorToken.kind) && (isDom(node.left) || isDom(node.right));
    }
    if (ts.isConditionalExpression(node)) return isDom(node.whenTrue) || isDom(node.whenFalse);
    if (ts.isArrayLiteralExpression(node)) return node.elements.some(isDom);
    if (ts.isObjectLiteralExpression(node)) return node.properties.some(item =>
      (ts.isPropertyAssignment(item) && isDom(item.initializer)) || (ts.isShorthandPropertyAssignment(item) && isDom(item.name)));
    return false;
  }
  // 简单别名传播；复杂数据流交给运行时保护，不声称静态检查能够穷尽 DOM 来源。
  for (let pass = 0; pass < 3; pass++) walk(file, node => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer) return;
    if (isDom(node.initializer) || (ts.isArrowFunction(node.initializer) && isDom(node.initializer.body))) aliases.add(node.name.text);
  });
  const failures = [];
  walk(file, node => {
    if (!ts.isCallExpression(node)) return;
    const fn = unwrap(node.expression);
    const comparison = ts.isIdentifier(fn) ? named.has(fn.text) : ts.isPropertyAccessExpression(fn) &&
      assertions.has(fn.expression.getText(file)) && comparisons.has(fn.name.text);
    if (comparison && node.arguments.slice(0, 2).some(isDom)) {
      failures.push({ filename, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1 });
    }
  });
  return failures;
}
