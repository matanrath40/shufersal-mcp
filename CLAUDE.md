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
- The browser launches **headed** (not headless) because the user must log in manually on first use.
- ESM throughout (`"type": "module"` in package.json, `.js` extensions in imports).
- Double quotes enforced by ESLint.

### Writing tools that make requests to Shufersal

When creating new tools that make fetch requests to Shufersal's API from inside the browser context, follow these rules:

1. **Verify the page is on Shufersal first** — check `page.url().includes("shufersal")` before running `executeScript()`. If not on Shufersal, return an error telling the user to call `open_shufersal`. Without this, `credentials: "include"` won't attach cookies (same-origin policy).

2. **Include the CSRF token** — Shufersal requires a CSRF token for all state-changing requests (POST/PUT/DELETE). Read it from the page's meta tags inside `page.evaluate()`:
   ```js
   const csrfMeta = document.querySelector("meta[name='_csrf']");
   const csrfHeaderMeta = document.querySelector("meta[name='_csrf_header']");
   const csrfToken = csrfMeta?.content ?? "";
   const csrfHeader = csrfHeaderMeta?.content ?? "CSRFToken";
   // Then add to fetch headers: { [csrfHeader]: csrfToken }
   ```
   Without this header, Shufersal silently redirects to the homepage with HTTP 200 — it does NOT return a 403.

3. **Use relative URLs without a leading slash** — `"cart/add"` not `"/cart/add"`. The page is at `shufersal.co.il/online/he/`, so a leading slash resolves from the domain root and skips `/online/he/`.

4. **Check for redirects in the response** — `response.ok && !response.redirected` is the correct success check. A 200 with `redirected: true` means the request was rejected.
