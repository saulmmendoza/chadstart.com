---
id: angular
title: Create a Full-Stack app with Angular and ChadStart
description: Quick start guide to create a full-stack app using Angular as a frontend and ChadStart as a backend.
---

# Quick start with Angular

Give a proper backend to your Angular app.

!!! warning
    This quick start guide focuses exclusively on the **frontend**. To ensure the functionality of this code, your ChadStart backend must be [up and running](./getting-started.md#install-chadstart) at `http://localhost:3000`.

## 1. Create a Angular app

If you already have your Angular app up and running, skip this step.

We will use the [Angular CLI](https://angular.dev/tools/cli) to create a new Angular project. You can replace `my-client` by the name of your front-end app.

```
ng new my-client
cd my-client
ng serve
```

## 2. Install ChadStart SDK

Install the JS SDK from the root of your Angular app.

```
npm i @chadstart/sdk
```

## 3. Use it in your app

In that example we are using a Cat entity [created previously](entities.md). Replace it by your own entity.

```js title="app.component.ts"
import { Component } from '@angular/core'
import ChadStart from '@chadstart/sdk'

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  cats: { id: string, name: string }[] = []

  async ngOnInit() {
    // Init SDK.
    const chadstart = new ChadStart()

    // Fetch the list of Cats.
    const result = await chadstart.from('cats').find()
    this.cats = result.data
  }
}
```

And in the template:

```html
<ul>
  <li *ngFor="let cat of cats">{{ cat.name }}</li>
</ul>
```

Checkout the [SDK doc](./crud.md#using-the-javascript-sdk) to see more usages of the SDK: CRUD operations, file upload, authentication,
