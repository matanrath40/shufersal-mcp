/**
 * Quick investigation script to discover how Shufersal's promo page serves data.
 *
 * Strategy 1: Fetch the promo URL with XHR headers (like search does) to see if it returns JSON.
 * Strategy 2: Intercept network requests while navigating to the promo page.
 *
 * Run: npx tsx scripts/investigate-promos.ts
 */

import { chromium } from "playwright";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const USER_DATA_DIR = process.env.BROWSER_USER_DATA_DIR || resolve(projectRoot, "browser-user-data");
const BASE_URL = "https://www.shufersal.co.il/online/he/";
const PROMO_URL = `${BASE_URL}promo/A`;

async function main() {
    console.log("Launching browser...");
    const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
        headless: false,
    });
    const page = context.pages()[0] || await context.newPage();

    // --- Strategy 2 prep: capture all XHR/fetch requests the page makes ---
    const capturedRequests: { url: string; method: string; resourceType: string }[] = [];
    page.on("request", (req) => {
        if (["xhr", "fetch"].includes(req.resourceType())) {
            capturedRequests.push({
                url: req.url(),
                method: req.method(),
                resourceType: req.resourceType(),
            });
        }
    });

    // First navigate to Shufersal so we're on the right origin (cookies, CSRF)
    console.log("\n1. Navigating to Shufersal homepage...");
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // --- Strategy 1: Fetch promo URL with XHR headers from browser context ---
    console.log("\n2. Strategy 1: Fetching promo URL with XHR headers...");
    const strategy1 = await page.evaluate(async (promoUrl: string) => {
        try {
            const response = await fetch(promoUrl, {
                headers: {
                    "accept": "application/json",
                    "x-requested-with": "XMLHttpRequest",
                },
                credentials: "include",
            });
            const contentType = response.headers.get("content-type") || "";
            const text = await response.text();
            return {
                status: response.status,
                contentType,
                redirected: response.redirected,
                bodyLength: text.length,
                // First 3000 chars to inspect structure
                bodyPreview: text.substring(0, 3000),
                // Check if it looks like JSON
                looksLikeJson: text.trimStart().startsWith("{") || text.trimStart().startsWith("["),
            };
        } catch (e) {
            return { error: String(e) };
        }
    }, PROMO_URL);

    console.log("Strategy 1 result:");
    console.log("  Status:", (strategy1 as any).status);
    console.log("  Content-Type:", (strategy1 as any).contentType);
    console.log("  Redirected:", (strategy1 as any).redirected);
    console.log("  Body length:", (strategy1 as any).bodyLength);
    console.log("  Looks like JSON:", (strategy1 as any).looksLikeJson);
    console.log("  Body preview (first 3000 chars):");
    console.log((strategy1 as any).bodyPreview || (strategy1 as any).error);

    // --- Strategy 1b: Try with pagination params ---
    console.log("\n3. Strategy 1b: Try with common pagination params...");
    const paginationUrls = [
        `${PROMO_URL}?q=:relevance&page=0&pageSize=20`,
        `${PROMO_URL}?page=0&size=20`,
        `${PROMO_URL}?currentPage=0&pageSize=20`,
    ];
    for (const url of paginationUrls) {
        const result = await page.evaluate(async (testUrl: string) => {
            try {
                const response = await fetch(testUrl, {
                    headers: {
                        "accept": "application/json",
                        "x-requested-with": "XMLHttpRequest",
                    },
                    credentials: "include",
                });
                const text = await response.text();
                return {
                    url: testUrl,
                    status: response.status,
                    contentType: response.headers.get("content-type") || "",
                    bodyLength: text.length,
                    looksLikeJson: text.trimStart().startsWith("{") || text.trimStart().startsWith("["),
                    bodyPreview: text.substring(0, 500),
                };
            } catch (e) {
                return { url: testUrl, error: String(e) };
            }
        }, url);
        console.log(`\n  URL: ${(result as any).url}`);
        console.log(`  Status: ${(result as any).status}, JSON: ${(result as any).looksLikeJson}, Length: ${(result as any).bodyLength}`);
        if ((result as any).looksLikeJson) {
            console.log(`  Preview: ${(result as any).bodyPreview}`);
        }
    }

    // --- Strategy 2: Navigate to the promo page and capture network requests ---
    console.log("\n4. Strategy 2: Navigating to promo page to capture XHR requests...");
    capturedRequests.length = 0; // reset
    await page.goto(PROMO_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    // Scroll down a bit to trigger lazy loading
    console.log("  Scrolling to trigger lazy load...");
    await page.evaluate(() => window.scrollBy(0, 2000));
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.scrollBy(0, 2000));
    await page.waitForTimeout(2000);

    console.log(`\n  Captured ${capturedRequests.length} XHR/fetch requests:`);
    for (const req of capturedRequests) {
        console.log(`  [${req.method}] ${req.url.substring(0, 200)}`);
    }

    // --- Strategy 2b: Fetch one of the captured API URLs to inspect response ---
    const interestingUrls = capturedRequests.filter(r =>
        r.url.includes("promo") || r.url.includes("product") || r.url.includes("search") ||
        r.url.includes("category") || r.url.includes("promotion") || r.url.includes("page")
    );
    if (interestingUrls.length > 0) {
        console.log("\n5. Inspecting interesting captured URLs...");
        for (const req of interestingUrls.slice(0, 3)) {
            const result = await page.evaluate(async (testUrl: string) => {
                try {
                    const response = await fetch(testUrl, {
                        headers: {
                            "accept": "application/json",
                            "x-requested-with": "XMLHttpRequest",
                        },
                        credentials: "include",
                    });
                    const text = await response.text();
                    return {
                        status: response.status,
                        contentType: response.headers.get("content-type") || "",
                        bodyLength: text.length,
                        bodyPreview: text.substring(0, 2000),
                    };
                } catch (e) {
                    return { error: String(e) };
                }
            }, req.url);
            console.log(`\n  URL: ${req.url.substring(0, 200)}`);
            console.log(`  Status: ${(result as any).status}, Length: ${(result as any).bodyLength}`);
            console.log(`  Preview: ${(result as any).bodyPreview?.substring(0, 1000)}`);
        }
    }

    console.log("\n--- Investigation complete ---");
    await context.close();
}

main().catch(console.error);
