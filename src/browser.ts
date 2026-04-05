/**
 * Based on https://github.com/modelcontextprotocol/servers-archived/tree/main/src/puppeteer
 * Migrated from Puppeteer to Playwright
 */

import { chromium, BrowserContext, Page } from "playwright";
import { CONFIG } from "./config.js";

/**
 * Global state management
 */
class BrowserState {
    private _context: BrowserContext | undefined;
    private _page: Page | undefined;
    private _consoleLogs: string[] = [];

    get context(): BrowserContext | undefined {
        return this._context;
    }

    get page(): Page | undefined {
        return this._page;
    }

    get consoleLogs(): string[] {
        return this._consoleLogs;
    }

    setContext(context: BrowserContext, page: Page): void {
        this._context = context;
        this._page = page;
    }

    addConsoleLog(log: string): void {
        this._consoleLogs.push(log);
    }
}

export const browserState = new BrowserState();

/**
 * Ensures browser is launched and returns the current page
 */
export async function ensureBrowser(): Promise<Page> {
    if (!browserState.context) {
        const context = await chromium.launchPersistentContext(CONFIG.USER_DATA_DIR, {
            args: ["--enable-save-password-bubble"],
            headless: false,
        });

        const pages = context.pages();
        const page = pages.length > 0 ? pages[0] : await context.newPage();

        // Set up console logging
        page.on("console", (msg) => {
            const logEntry = `[${msg.type()}] ${msg.text()}`;
            browserState.addConsoleLog(logEntry);
        });

        browserState.setContext(context, page);
    }

    return browserState.page!;
}

/**
 * Executes JavaScript in the browser context with console logging.
 * Console logs are captured globally via page.on("console").
 */
export async function executeScript<T = unknown>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback: (...args: any[]) => T | Promise<T>,
    args: unknown[]
): Promise<{ result: Awaited<T>, logs: string[] }> {
    const page = await ensureBrowser();
    const logsBefore = browserState.consoleLogs.length;

    const result = await page.evaluate(callback, ...args) as Awaited<T>;

    const newLogs = browserState.consoleLogs.slice(logsBefore);
    return { result, logs: newLogs };
}
