'use strict';

const assert = require('assert');
const {
  emit,
  subscribe,
  unsubscribe,
  subscribeFilter,
  unsubscribeFilter,
  matchesFilter,
  _subscriptions: subscriptions,
  _filterSubscriptions: filterSubscriptions,
} = require('../core/realtime');

// Minimal mock WebSocket
function createMockWs() {
  const ws = {
    OPEN: 1,
    readyState: 1,
    messages: [],
    send(payload) { ws.messages.push(JSON.parse(payload)); },
    lastMessage() { return ws.messages[ws.messages.length - 1]; },
  };
  return ws;
}

function cleanup() {
  subscriptions.clear();
  filterSubscriptions.clear();
}

describe('Realtime – entity-level subscriptions (backward compat)', function () {
  afterEach(cleanup);

  it('delivers events to entity subscribers', function () {
    const ws = createMockWs();
    subscribe('Post', ws);
    emit('Post.created', { id: '1', title: 'Hello' });
    assert.strictEqual(ws.messages.length, 1);
    assert.strictEqual(ws.messages[0].event, 'Post.created');
    assert.strictEqual(ws.messages[0].data.id, '1');
  });

  it('delivers events to wildcard subscribers', function () {
    const ws = createMockWs();
    subscribe('*', ws);
    emit('Comment.created', { id: '2' });
    assert.strictEqual(ws.messages.length, 1);
    assert.strictEqual(ws.messages[0].event, 'Comment.created');
  });

  it('does not deliver events for a different entity', function () {
    const ws = createMockWs();
    subscribe('Post', ws);
    emit('Comment.created', { id: '2' });
    assert.strictEqual(ws.messages.length, 0);
  });

  it('unsubscribe removes the client from the channel', function () {
    const ws = createMockWs();
    subscribe('Post', ws);
    unsubscribe('Post', ws);
    emit('Post.created', { id: '1' });
    assert.strictEqual(ws.messages.length, 0);
  });

  it('skips clients whose readyState is not OPEN', function () {
    const ws = createMockWs();
    ws.readyState = 3; // CLOSED
    subscribe('Post', ws);
    emit('Post.created', { id: '1' });
    assert.strictEqual(ws.messages.length, 0);
  });
});

describe('Realtime – record-level subscriptions', function () {
  afterEach(cleanup);

  it('delivers events to record-level subscribers', function () {
    const ws = createMockWs();
    subscribe('Post/abc123', ws);
    emit('Post.updated', { id: 'abc123', title: 'Updated' });
    assert.strictEqual(ws.messages.length, 1);
    assert.strictEqual(ws.messages[0].event, 'Post.updated');
    assert.strictEqual(ws.messages[0].data.id, 'abc123');
  });

  it('does not deliver events for a different record id', function () {
    const ws = createMockWs();
    subscribe('Post/abc123', ws);
    emit('Post.updated', { id: 'xyz789', title: 'Other' });
    assert.strictEqual(ws.messages.length, 0);
  });

  it('does not deliver record-level events when data has no id', function () {
    const ws = createMockWs();
    subscribe('Post/abc123', ws);
    emit('Post.created', { title: 'No id' });
    assert.strictEqual(ws.messages.length, 0);
  });

  it('delivers to both entity and record-level subscribers without duplicates', function () {
    const wsEntity = createMockWs();
    const wsRecord = createMockWs();
    const wsBoth = createMockWs();

    subscribe('Post', wsEntity);
    subscribe('Post/abc123', wsRecord);
    subscribe('Post', wsBoth);
    subscribe('Post/abc123', wsBoth);

    emit('Post.updated', { id: 'abc123', title: 'Updated' });

    assert.strictEqual(wsEntity.messages.length, 1);
    assert.strictEqual(wsRecord.messages.length, 1);
    // wsBoth should receive only one message (de-duplicated)
    assert.strictEqual(wsBoth.messages.length, 1);
  });

  it('unsubscribe record-level stops delivery', function () {
    const ws = createMockWs();
    subscribe('Post/abc123', ws);
    unsubscribe('Post/abc123', ws);
    emit('Post.updated', { id: 'abc123' });
    assert.strictEqual(ws.messages.length, 0);
  });
});

describe('Realtime – filter-based subscriptions', function () {
  afterEach(cleanup);

  it('delivers events that match the filter', function () {
    const ws = createMockWs();
    subscribeFilter('Post', ws, { status: 'published' });
    emit('Post.created', { id: '1', status: 'published' });
    assert.strictEqual(ws.messages.length, 1);
    assert.strictEqual(ws.messages[0].data.status, 'published');
  });

  it('does not deliver events that do not match the filter', function () {
    const ws = createMockWs();
    subscribeFilter('Post', ws, { status: 'published' });
    emit('Post.created', { id: '2', status: 'draft' });
    assert.strictEqual(ws.messages.length, 0);
  });

  it('supports multi-field filters', function () {
    const ws = createMockWs();
    subscribeFilter('Post', ws, { status: 'published', category: 'tech' });
    emit('Post.created', { id: '1', status: 'published', category: 'tech' });
    assert.strictEqual(ws.messages.length, 1);

    emit('Post.created', { id: '2', status: 'published', category: 'food' });
    // Still only the first event delivered
    assert.strictEqual(ws.messages.length, 1);
  });

  it('de-duplicates when client has entity-level AND filter subscription', function () {
    const ws = createMockWs();
    subscribe('Post', ws);
    subscribeFilter('Post', ws, { status: 'published' });
    emit('Post.created', { id: '1', status: 'published' });
    assert.strictEqual(ws.messages.length, 1);
  });

  it('unsubscribeFilter removes the filter subscription', function () {
    const ws = createMockWs();
    const filter = { status: 'published' };
    subscribeFilter('Post', ws, filter);
    unsubscribeFilter('Post', ws, filter);
    emit('Post.created', { id: '1', status: 'published' });
    assert.strictEqual(ws.messages.length, 0);
  });

  it('does not match when data is null or non-object', function () {
    assert.strictEqual(matchesFilter({ a: 1 }, null), false);
    assert.strictEqual(matchesFilter({ a: 1 }, 'string'), false);
    assert.strictEqual(matchesFilter({ a: 1 }, undefined), false);
  });

  it('filter for a different entity does not fire', function () {
    const ws = createMockWs();
    subscribeFilter('Comment', ws, { approved: true });
    emit('Post.created', { id: '1', approved: true });
    assert.strictEqual(ws.messages.length, 0);
  });
});

describe('Realtime – matchesFilter helper', function () {
  it('returns true when all filter keys match', function () {
    assert.strictEqual(matchesFilter({ a: 1, b: 2 }, { a: 1, b: 2, c: 3 }), true);
  });

  it('returns false when a filter key does not match', function () {
    assert.strictEqual(matchesFilter({ a: 1 }, { a: 2 }), false);
  });

  it('returns true for an empty filter', function () {
    assert.strictEqual(matchesFilter({}, { a: 1 }), true);
  });
});
