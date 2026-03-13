---
id: upload
title: File and Image Uploads
description: Upload files and images with ChadStart built-in storage system to upload assets in the file storage or any S3-compatible storage.
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Uploads

## Introduction

ChadStart comes with a **built-in storage system** to upload assets locally (default) or in a [S3 bucket](./s3-storage.md). You can use [file upload](#upload-a-file) to let your users update any kind of file, or [image upload](#upload-an-image) for image resizing.

A `public/storage` folder is automatically created when needed. Uploaded files and images will be renamed with a unique name and stored in a specific folder based on entity and property name, ending by a folder with the current month name to prevent having too many files in a single folder.

Example: _public/storage/project/contract/Nov24/8dab3936m1p54a66-contract.pdf_

:::warning

If you want to set this file as an item's property, you need to upload the file first and then add the new uploaded file path as the property value creating or updating a record.

:::

## Add a BASE_URL variable

ChadStart stores absolute paths for convenience.

By default the base url is set to `http://localhost:${port}` but you can change it using the `BASE_URL` environment variable in your `.env` file to adapt to your own base URL.

Example: `BASE_URL=https://example.com`.

:::warning

Changing the `BASE_URL` will not change the path of images and files that are already stored but it will impact the new ones.

:::

## Upload a file

A file should be related to a property with the [file property type](./entities.md#file).

<Tabs>
  <TabItem value="sdk" label="JS SDK" default>
    ```js

    // Create a Blob, adapt this step to your use case.
    const file = new Blob(['Hello, this is a test file!'], {
      type: 'text/plain',
    })

    // Upload a file that will be used as a contract for an invoice.
    const file = await chadstart.from('invoices').upload('contract', file)

    console.log(file)
    // Output: {"path":"http://localhost:3000/invoices/contract/Oct2024/8dabo9qm1q3swvu-my-contract.pdf"}


    // Then you can store the path in the database.
    const invoice = await chadstart.from('invoices').create({
      name: 'Invoice ACME',
      contract: file.path
    })
    ```

  </TabItem>
  <TabItem value="rest" label="REST API" default>
    ```http
    // Upload file.
    POST /api/upload/file
    Content-Type: multipart/form-data
    {
        file: (binary)
        entity: invoices
        property: contract
    }

    // Response.
    {
        "path":"http://localhost:3000/invoices/contract/Oct2024/8dabo9qm1q3swvu-my-contract.pdf"
    }
    ```

  </TabItem>
</Tabs>

## Upload an image

An image should be related to a property with the [image property type](./entities.md#image). ChadStart accepts **.PNG** and **.JPG** images only.

### Default behavior

By default, uploaded images are **compressed to JPEG** at quality 80. Resizing is **not applied** unless sizes are explicitly configured in the YAML — the image is stored as-is (after compression).

### Disable compression

Set `compress: false` on the image property to keep the original file untouched:

```yaml
entities:
  Cat:
    properties:
      - name: avatar
        type: image
        options:
          compress: false
```

You can also adjust the JPEG quality (1–100, default `80`):

```yaml
options:
  quality: 60
```

### Enable resizing

Define `sizes` on the image property to resize the image into one or more named variants. Each variant is stored as a separate JPEG file and the response contains a URL for each:

```yaml
entities:
  Cat:
    properties:
      - name: avatar
        type: image
        options:
          sizes:
            thumbnail: [80, 80]
            medium: [160, 160]
```

When sizes are configured, compression also applies to each resized variant (set `compress: false` to use lossless quality instead).

<Tabs>
  <TabItem value="sdk" label="JS SDK" default>
    ```js
    // Create a Blob from an image, adapt this step to your use case.
    const base64Image =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/wcAAwAB/eb7jLwAAAAASUVORK5CYII='
    const imageBlob: Blob = base64ToBlob(base64Image, 'image/png')

    // Upload the image (default: compressed to JPEG, no resize).
    const image = await chadstart.from('cats').uploadImage('avatar', imageBlob)

    console.log(image)
    // Output (no sizes configured):
    // { "path": "http://localhost:3000/cats/avatar/Oct2024/8dabo9qm1q4n1nk-avatar.jpg" }

    // Output (sizes configured in YAML):
    // {
    //   "medium": "http://localhost:3000/cats/avatar/Oct2024/8dabo9qm1q4n1nk-medium.jpg",
    //   "thumbnail": "http://localhost:3000/cats/avatar/Oct2024/8dabo9qm1q4n1nk-thumbnail.jpg"
    // }

    // Then you can store the path in the database.
    const cat = await chadstart.from('cats').create({
      name: 'Felix',
      image: image
    })
    ```

  </TabItem>
  <TabItem value="rest" label="REST API" default>
    ```http
    // Upload image.
    POST /api/upload/image
    Content-Type: multipart/form-data
    {
        image: (binary)
        entity: cats
        property: avatar
    }

    // Response (no sizes configured — default):
    {
      "path": "http://localhost:3000/cats/avatar/Oct2024/8dabo9qm1q4n1nk-avatar.jpg"
    }

    // Response (sizes configured in YAML):
    {
      "medium": "http://localhost:3000/cats/avatar/Oct2024/8dabo9qm1q4n1nk-medium.jpg",
      "thumbnail": "http://localhost:3000/cats/avatar/Oct2024/8dabo9qm1q4n1nk-thumbnail.jpg"
    }
    ```

  </TabItem>
</Tabs>
