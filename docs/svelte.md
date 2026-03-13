---
id: svelte
title: Create a Full-Stack app with Svelte and ChadStart
description: Quick start guide to create a full-stack app using Svelte as a frontend and ChadStart as a backend.
---

# Quick start with Svelte

Give a proper backend to your Svelte app.

!!! warning
    This quick start guide focuses exclusively on the **frontend**. To ensure the functionality of this code, your ChadStart backend must be [up and running](./index.md#install-chadstart) at `http://localhost:3000`.

## 1. Create a Svelte app

If you already have a Svelte app running, you can skip this step.

There are several ways to do that. In our example we use [SvelteKit](https://kit.svelte.dev/) to generate a pre-configured Svelte app, you . You can replace `my-client` by the name of your front-end app.

```
npm create svelte@latest my-client
cd my-client
npm install
npm run dev -- --open
```

## 2. Install ChadStart SDK

Install the JS SDK from the root of your Svelte app.

```
npm i @chadstart/sdk
```

## 3. Use it in your app

In that example we are using a Cat entity [created previously](entities.md). Replace it by your own entity. This example uses TypeScript, you can remove the typing to have plain JS.

```js title="src/routes/+page.svelte"


<script lang="ts">
  import ChadStart from "@chadstart/sdk";
  import { onMount } from "svelte";

  interface Cat {
    id: string;
    name: string;
    type: string;
    image: string;
  }

  let cats: Cat[] = [];

  onMount(async () => {
    const chadstart = new ChadStart();
    const result = await chadstart.from("cats").find<Cat>();
    cats = result.data;
  });
</script>

<div class="main">
  <ul>
    {#each cats as cat}
      <li>{cat.name}</li>
    {/each}
  </ul>
</div>
```

Checkout the [SDK doc](./crud.md#using-the-javascript-sdk) to see more usages of the SDK: CRUD operations, file upload, authentication,
