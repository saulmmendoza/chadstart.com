---
id: llm-rules
title: LLM Rules
description: Configure AI coding assistants to understand your ChadStart YAML backend. Works with Cursor, GitHub Copilot, Windsurf, and more.
---

# LLM Rules

ChadStart is designed to be **LLM-friendly**: the entire backend is described in a single YAML file that AI coding assistants can read, generate, and modify with ease.

When you scaffold a new project with the `--cursor`, `--copilot`, or `--windsurf` flag, ChadStart automatically creates the appropriate rules file that teaches your AI assistant about the `chadstart.yaml` format.

## Scaffolding with AI rules

=== "Cursor"

    ```bash
    npx chadstart my-project --cursor
    ```

    Creates `.cursor/rules/chadstart.mdc` — a Cursor rules file that helps Cursor understand the ChadStart schema.

=== "GitHub Copilot"

    ```bash
    npx chadstart my-project --copilot
    ```

    Creates `.github/copilot-instructions.md` — custom instructions for GitHub Copilot.

=== "Windsurf"

    ```bash
    npx chadstart my-project --windsurf
    ```

    Creates `.windsurf/rules/chadstart.md` — rules for the Windsurf AI assistant.

=== "No AI tool"

    ```bash
    npx chadstart my-project
    ```

    Creates the project without any AI assistant configuration.

## What the rules file contains

The generated rules file provides your AI assistant with:

- The full `chadstart.yaml` schema (entities, fields, auth, policies, etc.)
- Descriptions of available field types (`string`, `text`, `image`, `file`, `boolean`, `choice`, …)
- Examples of common patterns (authenticable entities, access policies, relations)
- Instructions on how to generate valid YAML for ChadStart

This means you can describe your app in plain English and let Cursor, Copilot, or Windsurf write the `chadstart.yaml` for you.

## Prompt examples

Once the rules file is in place you can use prompts like:

> *"Add a `Comment` entity with a `body` (text) field, a relation to `Post`, and make it authenticable so only the author can delete their own comments."*

> *"Add rate limiting: max 100 requests per minute."*

> *"Create a `Product` entity with a `name` (string), `price` (money), `image` (image), and a `category` choice field with options: Electronics, Clothing, Food."*

## Manual setup

If you already have an existing project and want to add AI rules manually, create one of the following files with content describing the [ChadStart YAML schema](./entities.md):

| AI tool            | Rules file location                            |
| ------------------ | ---------------------------------------------- |
| **Cursor**         | `.cursor/rules/chadstart.mdc`                  |
| **GitHub Copilot** | `.github/copilot-instructions.md`              |
| **Windsurf**       | `.windsurf/rules/chadstart.md`                 |

You can base your rules file on the [chadstart.example.yaml](https://github.com/saulmmendoza/chadstart.com/blob/main/chadstart.example.yaml) reference file, which documents every available configuration option.

!!! tip
    Keep your rules file up to date whenever you upgrade ChadStart. Newer versions may introduce new field types, options, or top-level blocks that your AI assistant won't know about unless the rules file is updated.
