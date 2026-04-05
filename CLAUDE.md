# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP (Model Context Protocol) server that automates shopping on Shufersal (Israeli grocery chain) using Playwright. It exposes tools that let LLMs search products, manage shopping lists, and add items to cart via browser automation.

## Commands

```bash
npm run build       # Compile TypeScript → dist/
npm run watch       # Compile in watch mode
npm run lint        # ESLint check
npm run lint:fix    # ESLint auto-fix
```

No test suite exists. The server runs via `node dist/index.js` over stdio (MCP transport).

## Architecture

- **`src/index.ts`** — Entry point. Creates `McpServer`, registers all tools, exposes a `console://logs` resource, handles graceful shutdown.
- **`src/browser.ts`** — Singleton `BrowserState` managing a Playwright browser context/page. `ensureBrowser()` lazily launches a headed browser with persistent user data via `launchPersistentContext`. `executeScript()` runs functions in the browser context; console logs are captured globally via `page.on("console")`.
- **`src/config.ts`** — Runtime constants (base URL, user data dir, search limit, wait timeout). Configurable via env vars `BROWSER_USER_DATA_DIR` (or legacy `PUPPETEER_USER_DATA_DIR`), `SEARCH_ITEMS_LIMIT`, `DEFAULT_WAIT_TIMEOUT`.
- **`src/types.shufersal.ts`** — TypeScript interfaces for Shufersal's API responses and the global `window.ajaxCall` function.
- **`src/tools/`** — Each file exports a `register*Tool(server)` function using `server.registerTool()` with Zod input schemas. Tools: `open_shufersal`, `search_shufersal`, `add_to_shufersal_cart`, `read_webpage_content`, `create_shopping_list_table`.

### Key patterns

- Tools execute Shufersal API calls **inside the browser context** via `executeScript()` (not from Node), so they inherit the user's authenticated session cookies.
- `window.ajaxCall` is Shufersal's global AJAX helper, used by `add_to_shufersal_cart` to post to `/cart/add`.
- The browser launches **headed** (not headless) because the user must log in manually on first use.
- ESM throughout (`"type": "module"` in package.json, `.js` extensions in imports).
- Double quotes enforced by ESLint.
