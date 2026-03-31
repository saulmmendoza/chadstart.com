'use strict';

const assert = require('assert');
const { evaluateExpression, parseExpression, ExpressionError } = require('../core/policy-expression');

describe('policy-expression – evaluateExpression()', () => {

  // ── Comparison operators ────────────────────────────────────────────────

  describe('comparison operators', () => {
    it('== with strings', () => {
      assert.strictEqual(evaluateExpression("@auth.role == 'admin'", { auth: { role: 'admin' } }), true);
      assert.strictEqual(evaluateExpression("@auth.role == 'admin'", { auth: { role: 'user' } }), false);
    });

    it('== with double-quoted strings', () => {
      assert.strictEqual(evaluateExpression('@auth.role == "admin"', { auth: { role: 'admin' } }), true);
    });

    it('!= operator', () => {
      assert.strictEqual(evaluateExpression("@auth.role != 'guest'", { auth: { role: 'admin' } }), true);
      assert.strictEqual(evaluateExpression("@auth.role != 'admin'", { auth: { role: 'admin' } }), false);
    });

    it('> and < operators', () => {
      assert.strictEqual(evaluateExpression('@auth.age > 18', { auth: { age: 21 } }), true);
      assert.strictEqual(evaluateExpression('@auth.age < 18', { auth: { age: 21 } }), false);
    });

    it('>= and <= operators', () => {
      assert.strictEqual(evaluateExpression('@auth.age >= 18', { auth: { age: 18 } }), true);
      assert.strictEqual(evaluateExpression('@auth.age <= 18', { auth: { age: 18 } }), true);
      assert.strictEqual(evaluateExpression('@auth.age >= 18', { auth: { age: 17 } }), false);
    });
  });

  // ── Logical operators ───────────────────────────────────────────────────

  describe('logical operators', () => {
    it('&& (and)', () => {
      assert.strictEqual(
        evaluateExpression("@auth.role == 'admin' && @auth.active == true", { auth: { role: 'admin', active: true } }),
        true
      );
      assert.strictEqual(
        evaluateExpression("@auth.role == 'admin' && @auth.active == true", { auth: { role: 'admin', active: false } }),
        false
      );
    });

    it('|| (or)', () => {
      assert.strictEqual(
        evaluateExpression("@auth.role == 'admin' || @auth.role == 'editor'", { auth: { role: 'editor' } }),
        true
      );
      assert.strictEqual(
        evaluateExpression("@auth.role == 'admin' || @auth.role == 'editor'", { auth: { role: 'viewer' } }),
        false
      );
    });

    it('! (not)', () => {
      assert.strictEqual(evaluateExpression("!(@auth.role == 'guest')", { auth: { role: 'admin' } }), true);
      assert.strictEqual(evaluateExpression("!(@auth.role == 'admin')", { auth: { role: 'admin' } }), false);
    });
  });

  // ── Variable access ─────────────────────────────────────────────────────

  describe('variable access', () => {
    it('@auth deep access', () => {
      assert.strictEqual(evaluateExpression("@auth.profile.level == 'pro'", { auth: { profile: { level: 'pro' } } }), true);
    });

    it('@record access', () => {
      assert.strictEqual(
        evaluateExpression("@auth.id == @record.author_id", { auth: { id: 42 }, record: { author_id: 42 } }),
        true
      );
      assert.strictEqual(
        evaluateExpression("@auth.id == @record.author_id", { auth: { id: 42 }, record: { author_id: 99 } }),
        false
      );
    });

    it('@request access', () => {
      assert.strictEqual(
        evaluateExpression("@request.body.type == 'blog'", { request: { body: { type: 'blog' } } }),
        true
      );
    });

    it('undefined nested path returns undefined', () => {
      assert.strictEqual(evaluateExpression("@auth.missing.deep == null", { auth: {} }), true);
    });
  });

  // ── Literals ────────────────────────────────────────────────────────────

  describe('literals', () => {
    it('boolean true/false', () => {
      assert.strictEqual(evaluateExpression('@auth.active == true', { auth: { active: true } }), true);
      assert.strictEqual(evaluateExpression('@auth.active == false', { auth: { active: false } }), true);
    });

    it('null', () => {
      assert.strictEqual(evaluateExpression('@record.deleted_at == null', { record: { deleted_at: null } }), true);
    });

    it('numbers', () => {
      assert.strictEqual(evaluateExpression('@record.count == 42', { record: { count: 42 } }), true);
    });
  });

  // ── `in` operator ──────────────────────────────────────────────────────

  describe('in operator', () => {
    it('membership in array', () => {
      assert.strictEqual(
        evaluateExpression("@auth.role in ['admin', 'editor']", { auth: { role: 'editor' } }),
        true
      );
      assert.strictEqual(
        evaluateExpression("@auth.role in ['admin', 'editor']", { auth: { role: 'viewer' } }),
        false
      );
    });

    it('throws if right side is not an array', () => {
      assert.throws(
        () => evaluateExpression("@auth.role in 'admin'", { auth: { role: 'admin' } }),
        /array/i
      );
    });
  });

  // ── Parentheses ─────────────────────────────────────────────────────────

  describe('parentheses', () => {
    it('groups expressions', () => {
      // Without parens: && binds tighter, so "a || (b && c)" — but with parens we change that
      assert.strictEqual(
        evaluateExpression("(@auth.role == 'admin' || @auth.role == 'editor') && @auth.active == true",
          { auth: { role: 'editor', active: true } }),
        true
      );
      assert.strictEqual(
        evaluateExpression("(@auth.role == 'admin' || @auth.role == 'editor') && @auth.active == true",
          { auth: { role: 'editor', active: false } }),
        false
      );
    });
  });

  // ── Complex / realistic policy expressions ─────────────────────────────

  describe('realistic policy expressions', () => {
    it("@auth.role == 'editor' — simple role check", () => {
      assert.strictEqual(evaluateExpression("@auth.role == 'editor'", { auth: { role: 'editor' } }), true);
    });

    it('@auth.id == @record.author_id — ownership check', () => {
      const ctx = { auth: { id: 'u1' }, record: { author_id: 'u1' } };
      assert.strictEqual(evaluateExpression('@auth.id == @record.author_id', ctx), true);
    });

    it("@auth.role == 'admin' || @auth.id == @record.author_id", () => {
      assert.strictEqual(
        evaluateExpression("@auth.role == 'admin' || @auth.id == @record.author_id",
          { auth: { id: 'u1', role: 'user' }, record: { author_id: 'u1' } }),
        true
      );
      assert.strictEqual(
        evaluateExpression("@auth.role == 'admin' || @auth.id == @record.author_id",
          { auth: { id: 'u1', role: 'admin' }, record: { author_id: 'u2' } }),
        true
      );
      assert.strictEqual(
        evaluateExpression("@auth.role == 'admin' || @auth.id == @record.author_id",
          { auth: { id: 'u1', role: 'user' }, record: { author_id: 'u2' } }),
        false
      );
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────

  describe('error handling', () => {
    it('throws on empty expression', () => {
      assert.throws(() => evaluateExpression('', {}), /non-empty/i);
    });

    it('throws on unknown variable', () => {
      assert.throws(() => evaluateExpression('@unknown.foo == 1', {}), /Unknown variable/);
    });

    it('throws on unterminated string', () => {
      assert.throws(() => evaluateExpression("@auth.role == 'admin", {}), /Unterminated/);
    });

    it('throws on unexpected character', () => {
      assert.throws(() => evaluateExpression('@auth.role ~ 1', {}), /Unexpected/);
    });
  });

  // ── parseExpression() ──────────────────────────────────────────────────

  describe('parseExpression()', () => {
    it('returns an AST node', () => {
      const ast = parseExpression("@auth.role == 'admin'");
      assert.strictEqual(ast.type, 'Compare');
      assert.strictEqual(ast.op, '==');
      assert.strictEqual(ast.left.type, 'Var');
      assert.deepStrictEqual(ast.left.path, ['auth', 'role']);
      assert.strictEqual(ast.right.type, 'Literal');
      assert.strictEqual(ast.right.value, 'admin');
    });
  });
});
