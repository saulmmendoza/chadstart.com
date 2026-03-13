# Realtime

ChadStart provides realtime event streaming via WebSocket.

## Connecting

Connect to the WebSocket server at `ws://localhost:3000/realtime`:

```js
const ws = new WebSocket('ws://localhost:3000/realtime');
```

## Subscribing to Events

Send a `subscribe` message to listen for changes on a specific entity:

```js
ws.send(JSON.stringify({ type: 'subscribe', channel: 'Post' }));
```

Subscribe to `*` to receive all events:

```js
ws.send(JSON.stringify({ type: 'subscribe', channel: '*' }));
```

## Receiving Events

```js
ws.onmessage = (e) => {
  const { event, data } = JSON.parse(e.data);
  // event: 'Post.created' | 'Post.updated' | 'Post.deleted'
  console.log(event, data);
};
```

## Event Types

| Event | Triggered When |
|-------|---------------|
| `EntityName.created` | A new record is created |
| `EntityName.updated` | A record is updated |
| `EntityName.deleted` | A record is deleted |
