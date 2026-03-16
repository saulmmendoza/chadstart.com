'use strict';
/**
 * onTodoCreated.js — ChadStart JS event-triggered function
 * Fires when a new Todo is created (event: todo.created).
 *
 * Runtime: js
 * Trigger: event — todo.created
 */
module.exports = async function handler(event, ctx) {
  const todo = event.data || event;
  console.log(`[todo.created] New todo: "${todo.title}" (id: ${todo.id})`);
  return { received: true, todoId: todo.id };
};
