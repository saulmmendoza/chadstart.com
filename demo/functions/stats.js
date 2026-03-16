'use strict';
/**
 * stats.js — ChadStart JS function
 * Returns todo statistics: total, completed, and pending counts.
 *
 * Runtime: js (default)
 * Trigger: GET /api/fn/stats (public)
 */
module.exports = async function handler(event, ctx) {
  const { chadstart } = ctx;
  if (!chadstart) {
    return { total: 0, completed: 0, pending: 0 };
  }
  // Use perPage:1 so we only fetch counts from the DB — no row data transferred.
  const [all, done] = await Promise.all([
    chadstart.todos.findAll({ perPage: 1 }),
    chadstart.todos.findAll({ completed: true, perPage: 1 }),
  ]);
  const total     = all.total  ?? 0;
  const completed = done.total ?? 0;
  return { total, completed, pending: total - completed };
};
