'use strict';

const { WebSocketServer } = require('ws');
const logger = require('../utils/logger');

let wss = null;
// Map of channel -> Set of WebSocket clients
const subscriptions = new Map();
// Map of entity -> Array of { ws, filter }
const filterSubscriptions = new Map();

/**
 * Attach a WebSocket server to an existing HTTP server.
 * Clients connect and send JSON messages to subscribe to channels.
 *
 * Subscribe message formats:
 *   Entity-level:  { "type": "subscribe", "channel": "Post" }
 *   Record-level:  { "type": "subscribe", "channel": "Post/abc123" }
 *   Filter-based:  { "type": "subscribe", "channel": "Post", "filter": { "status": "published" } }
 *
 * Event message format (server → client):
 *   { "type": "event", "event": "Post.created", "data": { ... } }
 */
function initRealtime(httpServer) {
  wss = new WebSocketServer({ server: httpServer, path: '/realtime' });

  wss.on('connection', (ws) => {
    logger.debug('Realtime: new client connected');
    const clientChannels = new Set();
    const clientFilters = [];

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'subscribe' && msg.channel) {
          if (msg.filter && typeof msg.filter === 'object') {
            subscribeFilter(msg.channel, ws, msg.filter);
            clientFilters.push({ channel: msg.channel, filter: msg.filter });
            ws.send(JSON.stringify({ type: 'subscribed', channel: msg.channel, filter: msg.filter }));
          } else {
            subscribe(msg.channel, ws);
            clientChannels.add(msg.channel);
            ws.send(JSON.stringify({ type: 'subscribed', channel: msg.channel }));
          }
        } else if (msg.type === 'unsubscribe' && msg.channel) {
          if (msg.filter && typeof msg.filter === 'object') {
            unsubscribeFilter(msg.channel, ws, msg.filter);
            const idx = clientFilters.findIndex(
              (f) => f.channel === msg.channel && JSON.stringify(f.filter) === JSON.stringify(msg.filter)
            );
            if (idx !== -1) clientFilters.splice(idx, 1);
            ws.send(JSON.stringify({ type: 'unsubscribed', channel: msg.channel, filter: msg.filter }));
          } else {
            unsubscribe(msg.channel, ws);
            clientChannels.delete(msg.channel);
            ws.send(JSON.stringify({ type: 'unsubscribed', channel: msg.channel }));
          }
        }
      } catch (err) {
        logger.debug('Realtime: invalid message', err.message);
      }
    });

    ws.on('close', () => {
      for (const channel of clientChannels) {
        unsubscribe(channel, ws);
      }
      for (const { channel, filter } of clientFilters) {
        unsubscribeFilter(channel, ws, filter);
      }
      logger.debug('Realtime: client disconnected');
    });
  });

  logger.info('Realtime WebSocket server ready at /realtime');
  return wss;
}

function subscribe(channel, ws) {
  if (!subscriptions.has(channel)) {
    subscriptions.set(channel, new Set());
  }
  subscriptions.get(channel).add(ws);
}

function unsubscribe(channel, ws) {
  if (subscriptions.has(channel)) {
    subscriptions.get(channel).delete(ws);
  }
}

function subscribeFilter(entity, ws, filter) {
  if (!filterSubscriptions.has(entity)) {
    filterSubscriptions.set(entity, []);
  }
  filterSubscriptions.get(entity).push({ ws, filter });
}

function unsubscribeFilter(entity, ws, filter) {
  const arr = filterSubscriptions.get(entity);
  if (!arr) return;
  const serialized = JSON.stringify(filter);
  const idx = arr.findIndex(
    (entry) => entry.ws === ws && JSON.stringify(entry.filter) === serialized
  );
  if (idx !== -1) arr.splice(idx, 1);
  if (arr.length === 0) filterSubscriptions.delete(entity);
}

/**
 * Check whether every key/value in the filter matches the data object.
 */
function matchesFilter(filter, data) {
  if (!data || typeof data !== 'object') return false;
  for (const key of Object.keys(filter)) {
    if (data[key] !== filter[key]) return false;
  }
  return true;
}

/**
 * Emit an event to all matching subscribers.
 * eventName format: "EntityName.created" | "EntityName.updated" | "EntityName.deleted"
 *
 * Delivery targets (all de-duplicated per client):
 *   1. Entity-level channel subscribers (e.g. "Post")
 *   2. Wildcard subscribers ("*")
 *   3. Record-level subscribers (e.g. "Post/<id>") when data.id is present
 *   4. Filter-based subscribers whose filter matches the emitted data
 */
function emit(eventName, data) {
  const entityName = eventName.split('.')[0];
  const sent = new Set();
  const payload = JSON.stringify({ type: 'event', event: eventName, data });

  function sendOnce(ws) {
    if (sent.has(ws)) return;
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
      sent.add(ws);
    }
  }

  // 1 & 2. Entity-level and wildcard channel subscribers
  const channels = [entityName, '*'];
  for (const channel of channels) {
    const clients = subscriptions.get(channel);
    if (!clients) continue;
    for (const ws of clients) {
      sendOnce(ws);
    }
  }

  // 3. Record-level subscribers ("Entity/recordId")
  const recordId = data && data.id;
  if (recordId != null) {
    const recordChannel = `${entityName}/${recordId}`;
    const clients = subscriptions.get(recordChannel);
    if (clients) {
      for (const ws of clients) {
        sendOnce(ws);
      }
    }
  }

  // 4. Filter-based subscribers
  const filterEntries = filterSubscriptions.get(entityName);
  if (filterEntries) {
    for (const { ws, filter } of filterEntries) {
      if (matchesFilter(filter, data)) {
        sendOnce(ws);
      }
    }
  }
}

function getWss() {
  return wss;
}

module.exports = {
  initRealtime,
  emit,
  subscribe,
  unsubscribe,
  subscribeFilter,
  unsubscribeFilter,
  matchesFilter,
  getWss,
  // Exposed for testing only
  _subscriptions: subscriptions,
  _filterSubscriptions: filterSubscriptions,
};
