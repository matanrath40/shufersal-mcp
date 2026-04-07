/**
 * Step 2: Inspect the /promo/A/fragment endpoint that the lazy loader uses.
 * Run: npx tsx scripts/investigate-promos-2.ts
 */

import { chromium } from "playwright";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const USER_DATA_DIR = process.env.BROWSER_USER_DATA_DIR || resolve(projectRoot, "browser-user-data");
const BASE_URL = "https://www.shufersal.co.il/online/he/";

async function main() {
    console.log("Launching browser...");
    const context = await chromium.launchPersistentContext(USER_DATA_DIR, { headless: false });
    const page = context.pages()[0] || await context.newPage();

    // Navigate to Shufersal first (same-origin)
    console.log("Navigating to Shufersal...");
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // Test the fragment endpoint with different accept headers
    const fragmentUrl = `${BASE_URL}promo/A/fragment?q=:relevance&page=0`;

    // Test 1: Plain fetch (probably returns HTML fragment)
    console.log("\n=== Test 1: Fragment endpoint (default headers) ===");
    const test1 = await page.evaluate(async (url: string) => {
        const response = await fetch(url, { credentials: "include" });
        const text = await response.text();
        return {
            status: response.status,
            contentType: response.headers.get("content-type") || "",
            bodyLength: text.length,
            bodyPreview: text.substring(0, 3000),
        };
    }, fragmentUrl);
    console.log(`Status: ${test1.status}, Content-Type: ${test1.contentType}, Length: ${test1.bodyLength}`);
    console.log("Preview:\n", test1.bodyPreview);

    // Test 2: With JSON accept header
    console.log("\n=== Test 2: Fragment endpoint (JSON accept) ===");
    const test2 = await page.evaluate(async (url: string) => {
        const response = await fetch(url, {
            headers: { "accept": "application/json", "x-requested-with": "XMLHttpRequest" },
            credentials: "include",
        });
        const text = await response.text();
        return {
            status: response.status,
            contentType: response.headers.get("content-type") || "",
            bodyLength: text.length,
            looksLikeJson: text.trimStart().startsWith("{") || text.trimStart().startsWith("["),
            bodyPreview: text.substring(0, 3000),
        };
    }, fragmentUrl);
    console.log(`Status: ${test2.status}, Content-Type: ${test2.contentType}, JSON: ${test2.looksLikeJson}, Length: ${test2.bodyLength}`);
    console.log("Preview:\n", test2.bodyPreview);

    // Test 3: Page 1 to see pagination behavior
    console.log("\n=== Test 3: Fragment page=1 ===");
    const test3 = await page.evaluate(async (baseUrl: string) => {
        const response = await fetch(`${baseUrl}promo/A/fragment?q=:relevance&page=1`, { credentials: "include" });
        const text = await response.text();
        return {
            status: response.status,
            bodyLength: text.length,
            bodyPreview: text.substring(0, 2000),
        };
    }, BASE_URL);
    console.log(`Status: ${test3.status}, Length: ${test3.bodyLength}`);
    console.log("Preview:\n", test3.bodyPreview);

    // Test 4: Check how many pages exist (try a high page number)
    console.log("\n=== Test 4: High page number (page=50) ===");
    const test4 = await page.evaluate(async (baseUrl: string) => {
        const response = await fetch(`${baseUrl}promo/A/fragment?q=:relevance&page=50`, { credentials: "include" });
        const text = await response.text();
        return {
            status: response.status,
            bodyLength: text.length,
            bodyPreview: text.substring(0, 500),
        };
    }, BASE_URL);
    console.log(`Status: ${test4.status}, Length: ${test4.bodyLength}`);
    console.log("Preview:\n", test4.bodyPreview);

    // Test 5: Also check if the initial promo page HTML contains product data/promotion info in embedded JSON
    console.log("\n=== Test 5: Check initial promo page for embedded product data ===");
    await page.goto(`${BASE_URL}promo/A`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const test5 = await page.evaluate(() => {
        // Look for product cards in the initial page load
        const productCards = document.querySelectorAll("[data-product-code]");
        const products: Array<{
            code: string;
            name: string;
            price: string;
            promoText: string;
            allDataAttrs: Record<string, string>;
        }> = [];

        for (const card of Array.from(productCards).slice(0, 5)) {
            const allDataAttrs: Record<string, string> = {};
            for (const attr of Array.from(card.attributes)) {
                if (attr.name.startsWith("data-")) {
                    allDataAttrs[attr.name] = attr.value;
                }
            }
            // Look for promotion text within the card
            const promoEl = card.querySelector(".promo, .promotion, .deal, .discount, .badge, .label, [class*='promo'], [class*='deal'], [class*='discount'], [class*='badge'], [class*='saving']");
            const nameEl = card.querySelector("a[title], .product-name, .productName, .name, [class*='title']");
            const priceEl = card.querySelector(".price, .product-price, [class*='price']");

            products.push({
                code: card.getAttribute("data-product-code") || "",
                name: nameEl?.getAttribute("title") || nameEl?.textContent?.trim() || "",
                price: priceEl?.textContent?.trim() || "",
                promoText: promoEl?.textContent?.trim() || "",
                allDataAttrs,
            });
        }

        // Also get a sample product card's full innerHTML for analysis
        const sampleCard = productCards[0];
        const sampleHtml = sampleCard ? sampleCard.innerHTML.substring(0, 3000) : "no cards found";

        // Check for any inline JSON/script with product data
        const scripts = document.querySelectorAll("script:not([src])");
        let embeddedData = "";
        for (const script of scripts) {
            const text = script.textContent || "";
            if (text.includes("product") || text.includes("promo") || text.includes("promotion")) {
                embeddedData += text.substring(0, 1000) + "\n---\n";
            }
        }

        return { products, sampleHtml, embeddedData: embeddedData.substring(0, 3000) };
    });
    console.log(`Found ${test5.products.length} product cards on initial page`);
    console.log("First 5 products:", JSON.stringify(test5.products, null, 2));
    console.log("\nSample card HTML:\n", test5.sampleHtml);
    console.log("\nEmbedded script data:\n", test5.embeddedData || "(none)");

    console.log("\n--- Investigation complete ---");
    await context.close();
}

main().catch(console.error);
