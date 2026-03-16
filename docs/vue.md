---
id: vue
title: Create a Full-Stack app with Vue and ChadStart
description: Quick start guide to create a full-stack app using Vue as a frontend and ChadStart as a backend.
---

# Quick start with Vue

Give a proper backend to your Vue.js app.

!!! warning
    This quick start guide focuses exclusively on the **frontend**. To ensure the functionality of this code, your ChadStart backend must be [up and running](./getting-started.md#install-chadstart) at `http://localhost:3000`.

## 1. Create a Vue app

If you already have a Vue app running, you can skip this step.

We are using Vue.js v3 in this tutorial. You can replace `my-client` by the name of your front-end app

```
npm create vue@latest
cd my-client // If you called your app "my-client" when asked in the previous step
npm install
npm run dev
```

## 2. Install ChadStart SDK

Install the JS SDK from the root of your Vue app.

```
npm i @chadstart/sdk
```

## 3. Use it in your app

In that example we are using a Cat entity [created previously](entities.md). Replace it by your own entity. This example uses TypeScript, you can remove the typing to have plain JS.

```js
<script lang="ts">
import ChadStart from "@chadstart/sdk";

interface Cat {
  id: string;
  name: string;
  type: string;
  image: string;
}

export default {
  data() {
    return {
      cats: [] as Cat[],
    };
  },
  mounted() {
    this.fetchCat();
  },
  methods: {
    async fetchCat() {

      // Init SDK
      const chadstart = new ChadStart();

      // Fetch Cats from the backend.
      chadstart.from("cats")
        .find<Cat>()
        .then((res) => {
          // Store the response in the "cats" array
          this.cats = res.data;
        });
    },
  },
};
</script>

<template>
    <ul>
        <li v-for="cat of cats">{{ cat.name }}</li>
    </ul>
</template>


```

Checkout the [SDK doc](./crud.md#using-the-javascript-sdk) to see more usages of the SDK.,
