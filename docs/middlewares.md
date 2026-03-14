---
id: middlewares
title: Middlewares
description: Add middlewares to trigger custom logic at defined lifecycle events of your ChadStart backend. 6 available events related to entities.
---

## Introduction

**Middleware functions** or **middlewares** are intermediary functions that sit between the client's request and the server's response. They have access to the request object (req) and the response object (res).

As ChadStart works with **ExpressJS**, ChadStart middlewares are [ExpressJS middlewares](https://expressjs.com/en/guide/using-middleware.html) enhanced with the [ChadStart SDK](./crud.md#using-the-javascript-sdk) that allows you to interact with your data with ease.

## Middleware use cases

Here are some examples of middleware use cases:

- Patch the request body before storing it in the DB
- Call an external API or any other custom logic
- Hide some data from the response
- Trigger an internal or external action on an event (see also [webhooks](./webhooks.md))

## Syntax

```yaml title="chadstart.yaml"
entities:
  Project 🗂️:
    properties:
      - name
      - { name: date, type: date }
    middlewares:
      beforeCreate:
        - function: setDate
      afterCreate:
        - function: sendEmail
```

This example triggers the function located at `/functions/setDate.js` before the item is created and stored in the database, and triggers `/functions/sendEmail.js` after.

```js title="/functions/setDate.js"
module.exports = async (req, res) => {
  console.log('Hello from the function!')

  req.body['date'] = new Date()
}
```

!!! tip
    You can add **several middlewares** for an event. They will be processed sequentially in the order you define.

## Use your data with the ChadStart backend SDK

ChadStart passes the [JS SDK](./crud.md#using-the-javascript-sdk) to middleware functions as third argument. You can use it to fetch or write data.

```js title="/functions/patchDocumentNameIfEmpty.js"
module.exports = async (req, res, chadstart) => {
  // If the 'name' property of the item is empty.
  if (!req.body['name']) {
    // Get the user from the request body.
    const user = await chadstart.from('users').findOneById(req.body['userId'])

    // Set a custom name based on the user.
    req.body['name'] = `${user.name}'s untitled document`
  }
}
```

## Events

This is the list and description of the 6 events available to which you can attach middlewares. All of them are related to an [entity](./entities.md)

| Name             | Description              |
| ---------------- | ------------------------ |
| **beforeCreate** | Before creating a record |
| **afterCreate**  | After creating a record  |
| **beforeUpdate** | Before updating a record |
| **afterUpdate**  | After updating a record  |
| **beforeDelete** | Before deleting a record |
| **afterDelete**  | After deleting a record  |
