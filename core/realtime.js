'use strict';

const { WebSocketServer } = require('ws');
const logger = require('../utils/logger');

let wss = null;
// Map of channel -> Set of WebSocket clients
const subscriptions = new Map();

/**
 * Attach a WebSocket server to an existing HTTP server.
 * Clients connect and send JSON messages to subscribe to channels.
 *
 * Subscribe message format:
 *   { "type": "subscribe", "channel": "Post" }
 *
 * Event message format (server → client):
 *   { "type": "event", "event": "Post.created", "data": { ... } }
 */
function initRealtime(httpServer) {
  wss = new WebSocketServer({ server: httpServer, path: '/realtime' });

  wss.on('connection', (ws) => {
    logger.debug('Realtime: new client connected');
    const clientChannels = new Set();

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'subscribe' && msg.channel) {
          subscribe(msg.channel, ws);
          clientChannels.add(msg.channel);
          ws.send(JSON.stringify({ type: 'subscribed', channel: msg.channel }));
        } else if (msg.type === 'unsubscribe' && msg.channel) {
          unsubscribe(msg.channel, ws);
          clientChannels.delete(msg.channel);
          ws.send(JSON.stringify({ type: 'unsubscribed', channel: msg.channel }));
        }
      } catch (err) {
        logger.debug('Realtime: invalid message', err.message);
      }
    });

    ws.on('close', () => {
      for (const channel of clientChannels) {
        unsubscribe(channel, ws);
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

/**
 * Emit an event to all subscribers of the entity channel.
 * eventName format: "EntityName.created" | "EntityName.updated" | "EntityName.deleted"
 */
function emit(eventName, data) {
  const entityName = eventName.split('.')[0];
  const channels = [entityName, '*'];

  for (const channel of channels) {
    const clients = subscriptions.get(channel);
    if (!clients) continue;
    const payload = JSON.stringify({ type: 'event', event: eventName, data });
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) {
        ws.send(payload);
      }
    }
  }
}

function getWss() {
  return wss;
}

module.exports = { initRealtime, emit, subscribe, unsubscribe, getWss };
