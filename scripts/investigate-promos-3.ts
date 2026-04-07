/**
 * Step 3: Check if the search API returns promotion data in the raw response.
 * Run: npx tsx scripts/investigate-promos-3.ts
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

    console.log("Navigating to Shufersal...");
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // Search for common products likely to have promotions (milk, chocolate, etc.)
    const queries = ["חלב", "שוקולד"];

    for (const query of queries) {
        console.log(`\n=== Search API raw response for "${query}" ===`);
        const result = await page.evaluate(async (args: { query: string, baseUrl: string }) => {
            const urlObject = new URL(`${args.baseUrl}search/results`);
            urlObject.searchParams.set("q", args.query);
            urlObject.searchParams.set("limit", "3");

            const response = await fetch(urlObject.toString(), {
                headers: {
                    "accept": "application/json",
                    "x-requested-with": "XMLHttpRequest",
                },
                credentials: "include",
            });
            return await response.json();
        }, { query, baseUrl: BASE_URL });

        // Print FULL raw response for first 2 items to see all fields
        const results = (result as any).results || [];
        console.log(`Got ${results.length} results`);
        for (const item of results.slice(0, 2)) {
            console.log("\n--- Full raw item ---");
            console.log(JSON.stringify(item, null, 2));
        }

        // Also check top-level response keys
        console.log("\n--- Top-level response keys ---");
        console.log(Object.keys(result as any));
    }

    // Also check: does the promo fragment HTML contain the actual product codes for multi-buy deals?
    // Let's get a bigger sample of promo cards
    console.log("\n=== Promo page: detailed card extraction (first 10 items) ===");
    await page.goto(`${BASE_URL}promo/A`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    const promoData = await page.evaluate(() => {
        const cards = document.querySelectorAll("[data-promo]");
        const items: Array<{
            promoId: string;
            productCode: string;
            fullText: string;
            descriptionHtml: string;
            allClasses: string;
        }> = [];

        for (const card of Array.from(cards).slice(0, 10)) {
            // Get the inner text container
            const textContainer = card.querySelector(".textContainer .text");
            items.push({
                promoId: card.getAttribute("data-promo") || "",
                productCode: card.getAttribute("data-product-code") || "",
                fullText: card.textContent?.replace(/\s+/g, " ").trim().substring(0, 300) || "",
                descriptionHtml: textContainer?.innerHTML?.substring(0, 500) || "",
                allClasses: card.className,
            });
        }
        return items;
    });

    for (const item of promoData) {
        console.log(`\nPromo ${item.promoId} | Product: ${item.productCode || "(multi-buy)"}`);
        console.log(`  Text: ${item.fullText.substring(0, 200)}`);
        console.log(`  HTML: ${item.descriptionHtml.substring(0, 300)}`);
    }

    console.log("\n--- Investigation complete ---");
    await context.close();
}

main().catch(console.error);
