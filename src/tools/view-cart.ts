import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ensureBrowser } from "../browser.js";
import { CONFIG } from "../config.js";

export const registerViewCartTool = (server: McpServer) => {
    server.registerTool(
        "view_shufersal_cart",
        {
            description: "View the current shopping cart contents including items, quantities, prices, and total. Navigates to the cart page and reads the contents.",
            inputSchema: {}
        },
        async () => {
            try {
                const page = await ensureBrowser();

                // Navigate to cart page (redirects to /cart/cartsummary)
                await page.goto(`${CONFIG.SHUFERSAL_BASE_URL}cart`, { waitUntil: "domcontentloaded" });
                await page.waitForTimeout(CONFIG.DEFAULT_WAIT_TIMEOUT);

                const cartData = await page.evaluate(() => {
                    const items: Array<{
                        name: string;
                        price: string;
                        quantity: string;
                        productCode: string;
                    }> = [];

                    // Each cart item has a .topContainer.contentInCart parent
                    // with a [data-product-code] element inside.
                    // Find unique product entries by looking for the add-to-cart containers
                    // which each correspond to one distinct product.
                    const cartRows = document.querySelectorAll(".topContainer.contentInCart");

                    for (const row of cartRows) {
                        const productCodeEl = row.closest("[data-product-code]") ||
                            row.querySelector("[data-product-code]");
                        const productCode = productCodeEl?.getAttribute("data-product-code") || "";

                        const nameEl = row.querySelector("a[title], .product-name, .productName, .name");
                        const priceEl = row.querySelector(".price, .product-price, .totalPrice");
                        const qtyEl = row.querySelector("input[type='number'], .quantity input, .qty input") as HTMLInputElement | null;

                        items.push({
                            name: nameEl?.getAttribute("title") || nameEl?.textContent?.trim() || "",
                            price: priceEl?.textContent?.trim() || "",
                            quantity: qtyEl?.value || qtyEl?.textContent?.trim() || "",
                            productCode,
                        });
                    }

                    // Deduplicate by productCode (in case of nested matches)
                    const seen = new Set<string>();
                    const uniqueItems = items.filter(item => {
                        if (!item.productCode || seen.has(item.productCode)) return false;
                        seen.add(item.productCode);
                        return true;
                    });

                    // If the structured approach found nothing, fall back to main content text
                    let pageSummary = "";
                    if (uniqueItems.length === 0) {
                        const main = document.querySelector("main.miglog-cart-summary, main");
                        pageSummary = main?.textContent?.replace(/\s+/g, " ").trim().substring(0, 2000) || "";
                    }

                    return { items: uniqueItems, pageSummary };
                });

                if (cartData.items.length > 0) {
                    let text = `Cart contains ${cartData.items.length} item(s):\n\n`;
                    for (const item of cartData.items) {
                        text += `- ${item.name || "(unknown)"}`;
                        if (item.quantity) text += ` x${item.quantity}`;
                        if (item.price) text += ` — ${item.price}`;
                        if (item.productCode) text += ` [${item.productCode}]`;
                        text += "\n";
                    }
                    return { content: [{ type: "text", text }] };
                }

                if (cartData.pageSummary) {
                    return {
                        content: [{
                            type: "text",
                            text: `Could not parse structured cart items. Page content:\n${cartData.pageSummary}`,
                        }],
                    };
                }

                return {
                    content: [{
                        type: "text",
                        text: "Cart appears to be empty or could not be read.",
                    }],
                };
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error viewing cart: ${(error as Error).message}`,
                    }],
                    isError: true,
                };
            }
        }
    );
};
