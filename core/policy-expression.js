'use strict';

/**
 * Safe expression evaluator for custom policy conditions.
 *
 * Supports:
 *   Variables   – @auth, @record, @request  (with dot access)
 *   Literals    – strings ('…'/"…"), numbers, true, false, null
 *   Comparison  – ==  !=  >  <  >=  <=
 *   Logical     – &&  ||  !
 *   Membership  – in  (e.g. @auth.role in ['admin', 'editor'])
 *   Grouping    – ( … )
 *   Arrays      – [ … ]  (used only on the right-hand side of `in`)
 *
 * NO eval(), NO new Function().  A recursive-descent parser produces a
 * minimal AST which is then evaluated against a context object.
 */

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

const TOKEN = {
  NUMBER:  'NUMBER',
  STRING:  'STRING',
  BOOL:    'BOOL',
  NULL:    'NULL',
  VAR:     'VAR',       // @auth, @record, @request
  DOT:     'DOT',
  IDENT:   'IDENT',     // bare identifiers after dot
  LPAREN:  'LPAREN',
  RPAREN:  'RPAREN',
  LBRACK:  'LBRACK',
  RBRACK:  'RBRACK',
  COMMA:   'COMMA',
  OP:      'OP',        // ==, !=, >=, <=, >, <
  AND:     'AND',       // &&
  OR:      'OR',        // ||
  NOT:     'NOT',       // !
  IN:      'IN',        // in
  EOF:     'EOF',
};

function tokenize(expr) {
  const tokens = [];
  let i = 0;

  while (i < expr.length) {
    // Skip whitespace
    if (/\s/.test(expr[i])) { i++; continue; }

    // Variable references: @auth, @record, @request
    if (expr[i] === '@') {
      let name = '@';
      i++;
      while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) { name += expr[i++]; }
      if (!['@auth', '@record', '@request'].includes(name)) {
        throw new ExpressionError(`Unknown variable "${name}". Allowed: @auth, @record, @request`);
      }
      tokens.push({ type: TOKEN.VAR, value: name });
      continue;
    }

    // Dot
    if (expr[i] === '.') { tokens.push({ type: TOKEN.DOT, value: '.' }); i++; continue; }

    // Brackets & parens & comma
    if (expr[i] === '(') { tokens.push({ type: TOKEN.LPAREN, value: '(' }); i++; continue; }
    if (expr[i] === ')') { tokens.push({ type: TOKEN.RPAREN, value: ')' }); i++; continue; }
    if (expr[i] === '[') { tokens.push({ type: TOKEN.LBRACK, value: '[' }); i++; continue; }
    if (expr[i] === ']') { tokens.push({ type: TOKEN.RBRACK, value: ']' }); i++; continue; }
    if (expr[i] === ',') { tokens.push({ type: TOKEN.COMMA, value: ',' }); i++; continue; }

    // Two-char operators: ==, !=, >=, <=, &&, ||
    const two = expr.slice(i, i + 2);
    if (two === '==' || two === '!=' || two === '>=' || two === '<=') {
      tokens.push({ type: TOKEN.OP, value: two }); i += 2; continue;
    }
    if (two === '&&') { tokens.push({ type: TOKEN.AND, value: '&&' }); i += 2; continue; }
    if (two === '||') { tokens.push({ type: TOKEN.OR, value: '||' }); i += 2; continue; }

    // Single-char operators: >, <
    if (expr[i] === '>' || expr[i] === '<') {
      tokens.push({ type: TOKEN.OP, value: expr[i] }); i++; continue;
    }

    // NOT (! but not !=)
    if (expr[i] === '!') { tokens.push({ type: TOKEN.NOT, value: '!' }); i++; continue; }

    // Strings
    if (expr[i] === "'" || expr[i] === '"') {
      const quote = expr[i];
      let str = '';
      i++; // skip opening quote
      while (i < expr.length && expr[i] !== quote) {
        if (expr[i] === '\\' && i + 1 < expr.length) { str += expr[++i]; }
        else { str += expr[i]; }
        i++;
      }
      if (i >= expr.length) throw new ExpressionError(`Unterminated string literal`);
      i++; // skip closing quote
      tokens.push({ type: TOKEN.STRING, value: str });
      continue;
    }

    // Numbers
    if (/[0-9]/.test(expr[i]) || (expr[i] === '-' && i + 1 < expr.length && /[0-9]/.test(expr[i + 1]))) {
      let num = '';
      if (expr[i] === '-') { num += expr[i++]; }
      while (i < expr.length && /[0-9.]/.test(expr[i])) { num += expr[i++]; }
      tokens.push({ type: TOKEN.NUMBER, value: Number(num) });
      continue;
    }

    // Identifiers: true, false, null, in, or dot-access property names
    if (/[a-zA-Z_]/.test(expr[i])) {
      let ident = '';
      while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) { ident += expr[i++]; }
      if (ident === 'true' || ident === 'false') {
        tokens.push({ type: TOKEN.BOOL, value: ident === 'true' });
      } else if (ident === 'null') {
        tokens.push({ type: TOKEN.NULL, value: null });
      } else if (ident === 'in') {
        tokens.push({ type: TOKEN.IN, value: 'in' });
      } else {
        tokens.push({ type: TOKEN.IDENT, value: ident });
      }
      continue;
    }

    throw new ExpressionError(`Unexpected character "${expr[i]}" at position ${i}`);
  }

  tokens.push({ type: TOKEN.EOF, value: null });
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser  (recursive descent → AST)
// ---------------------------------------------------------------------------

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek()    { return this.tokens[this.pos]; }
  advance() { return this.tokens[this.pos++]; }

  expect(type) {
    const t = this.advance();
    if (t.type !== type) throw new ExpressionError(`Expected ${type} but got ${t.type} ("${t.value}")`);
    return t;
  }

  // entry → or_expr
  parse() {
    const node = this.orExpr();
    if (this.peek().type !== TOKEN.EOF) {
      throw new ExpressionError(`Unexpected token "${this.peek().value}" after expression`);
    }
    return node;
  }

  // or_expr → and_expr ( '||' and_expr )*
  orExpr() {
    let left = this.andExpr();
    while (this.peek().type === TOKEN.OR) {
      this.advance();
      left = { type: 'LogicalOr', left, right: this.andExpr() };
    }
    return left;
  }

  // and_expr → not_expr ( '&&' not_expr )*
  andExpr() {
    let left = this.notExpr();
    while (this.peek().type === TOKEN.AND) {
      this.advance();
      left = { type: 'LogicalAnd', left, right: this.notExpr() };
    }
    return left;
  }

  // not_expr → '!' not_expr | comparison
  notExpr() {
    if (this.peek().type === TOKEN.NOT) {
      this.advance();
      return { type: 'Not', operand: this.notExpr() };
    }
    return this.comparison();
  }

  // comparison → primary ( ('=='|'!='|'>'|'<'|'>='|'<='|'in') primary )?
  comparison() {
    let left = this.primary();
    const t = this.peek();
    if (t.type === TOKEN.OP) {
      const op = this.advance().value;
      const right = this.primary();
      return { type: 'Compare', op, left, right };
    }
    if (t.type === TOKEN.IN) {
      this.advance();
      const right = this.primary();
      return { type: 'In', left, right };
    }
    return left;
  }

  // primary → LITERAL | VAR(.IDENT)* | '(' or_expr ')' | '[' list ']'
  primary() {
    const t = this.peek();

    // Parenthesised expression
    if (t.type === TOKEN.LPAREN) {
      this.advance();
      const node = this.orExpr();
      this.expect(TOKEN.RPAREN);
      return node;
    }

    // Array literal
    if (t.type === TOKEN.LBRACK) {
      this.advance();
      const elements = [];
      if (this.peek().type !== TOKEN.RBRACK) {
        elements.push(this.orExpr());
        while (this.peek().type === TOKEN.COMMA) {
          this.advance();
          elements.push(this.orExpr());
        }
      }
      this.expect(TOKEN.RBRACK);
      return { type: 'Array', elements };
    }

    // Variable access: @auth.role.foo
    if (t.type === TOKEN.VAR) {
      this.advance();
      const path = [t.value.slice(1)]; // strip '@'
      while (this.peek().type === TOKEN.DOT) {
        this.advance();
        const prop = this.advance();
        if (prop.type !== TOKEN.IDENT && prop.type !== TOKEN.VAR) {
          throw new ExpressionError(`Expected property name after ".", got "${prop.value}"`);
        }
        path.push(prop.value);
      }
      return { type: 'Var', path };
    }

    // Literals
    if (t.type === TOKEN.STRING)  { this.advance(); return { type: 'Literal', value: t.value }; }
    if (t.type === TOKEN.NUMBER)  { this.advance(); return { type: 'Literal', value: t.value }; }
    if (t.type === TOKEN.BOOL)    { this.advance(); return { type: 'Literal', value: t.value }; }
    if (t.type === TOKEN.NULL)    { this.advance(); return { type: 'Literal', value: null }; }

    throw new ExpressionError(`Unexpected token "${t.value}" (${t.type})`);
  }
}

function parseExpression(expr) {
  const tokens = tokenize(expr);
  return new Parser(tokens).parse();
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

function evaluateAST(node, ctx) {
  switch (node.type) {
    case 'Literal':
      return node.value;

    case 'Array':
      return node.elements.map((el) => evaluateAST(el, ctx));

    case 'Var': {
      let val = ctx;
      for (const key of node.path) {
        if (val == null) return undefined;
        val = val[key];
      }
      return val;
    }

    case 'Not':
      return !evaluateAST(node.operand, ctx);

    case 'LogicalAnd':
      return evaluateAST(node.left, ctx) && evaluateAST(node.right, ctx);

    case 'LogicalOr':
      return evaluateAST(node.left, ctx) || evaluateAST(node.right, ctx);

    case 'In': {
      const left = evaluateAST(node.left, ctx);
      const right = evaluateAST(node.right, ctx);
      if (!Array.isArray(right)) throw new ExpressionError(`"in" operator requires an array on the right side`);
      return right.includes(left);
    }

    case 'Compare': {
      const left = evaluateAST(node.left, ctx);
      const right = evaluateAST(node.right, ctx);
      switch (node.op) {
        case '==': return left == right;   // eslint-disable-line eqeqeq
        case '!=': return left != right;   // eslint-disable-line eqeqeq
        case '>':  return left > right;
        case '<':  return left < right;
        case '>=': return left >= right;
        case '<=': return left <= right;
        default: throw new ExpressionError(`Unknown operator "${node.op}"`);
      }
    }

    default:
      throw new ExpressionError(`Unknown AST node type "${node.type}"`);
  }
}

/**
 * Evaluate a policy expression string against the given context.
 *
 * @param {string} expr        – e.g. "@auth.role == 'admin'"
 * @param {{ auth: object, record: object, request: object }} context
 * @returns {boolean}
 */
function evaluateExpression(expr, context) {
  if (typeof expr !== 'string' || !expr.trim()) {
    throw new ExpressionError('Expression must be a non-empty string');
  }
  const ast = parseExpression(expr.trim());
  return !!evaluateAST(ast, context);
}

// ---------------------------------------------------------------------------
// Custom error class
// ---------------------------------------------------------------------------

class ExpressionError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'ExpressionError';
  }
}

module.exports = { evaluateExpression, parseExpression, ExpressionError };
