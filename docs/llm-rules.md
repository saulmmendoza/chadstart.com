---
id: llm-rules
title: LLM Rules
descriptions: Use ChadStart rules in your AI Code Editor to improve your LLM understanding of ChadStart backend.
---

# LLM rules

Rules are predefined guidelines and constraints that steer an AI assistant's behavior. They specify the style, conventions, best practices, or security policies to follow. Rules ensure consistency, quality, and compliance of the generated suggestions.

## Usage

Running the install command above will add the rules to the ChadStart rules in your project.

```bash
npx chadstart dev --cursor
```

You can replace `--cursor` with another option if you're using a different AI tool;

- `--copilot` if you're using GitHub Copilot
- `--windsurf` for Windsurf

If you need to install rules manually, download the file below and add it to your AI code editor:

<a href="https://raw.githubusercontent.com/mnfst/rules/refs/heads/main/src/rules.md" download>
  ⬇️ Download ChadStart Rules
</a>

## Integration with Lovable, Bolt.new and vibe coding tools

<div style={{ backgroundColor: '#d6ffee', padding: '1em 1em 0.1em 1em', borderRadius: '12px' }}>

ChadStart already works with ❤️ [Lovable](https://lovable.dev) and [Bolt.new](https://bolt.new) if you clone the project and run it locally. However it is still hard to convince those LLM to use chadstart as a backend as they have been programmed to do otherwise. With a native integration, you could launch ChadStart directly inside them.

Want to see ChadStart inside **Lovable** ? ⬆️ **[Upvote the idea](https://lovable.featurebase.app/fr/p/chadstartbuild-integration?slug=chadstartbuild-integration)**.

</div>

## Types and OpenAPI Generation

When you run ChadStart, it generates 2 key context files in the **/.chadstart** folder:

- **openapi.yml**: [OpenAPI](https://www.openapis.org/) spec for the available endpoints, schemas, and the API base URL of your backend.
- **types.ts**: type file with typings and DTOs (Data Transfer Object) for each entity.

By including these context files, ChadStart ensures your AI code editor understands your API, enabling smarter and more reliable code generation,especially when you want to connect a frontend to your ChadStart backend.
