import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ensureBrowser, executeScript } from "../browser.js";

export const registerAddToShufersalCartTool = (server: McpServer) => {
    server.registerTool(
        "add_to_shufersal_cart",
        {
            description: "Add a product to the shopping cart. Must be used after searching for the product.",
            inputSchema: {
                product_id: z.string().describe("Product ID from search results"),
                sellingMethod: z.string().describe("Selling method from search results"),
                qty: z.number().min(1).describe("Quantity to add to cart"),
                comment: z.string().optional().describe("Optional comment for the product"),
            }
        },
        async ({ product_id, sellingMethod, qty, comment }: { product_id: string, sellingMethod: string, qty: number, comment?: string }) => {
            try {
                const page = await ensureBrowser();
                const currentUrl = page.url();

                if (!currentUrl.includes("shufersal")) {
                    return {
                        content: [{
                            type: "text" as const,
                            text: "Please open the Shufersal website first using the 'open_shufersal' tool",
                        }],
                        isError: true,
                    };
                }

                const addToCartFunction = async (runArgs: { product_id: string, sellingMethod: string, qty: number, comment?: string }) => {
                    const csrfMeta = document.querySelector("meta[name='_csrf']") as HTMLMetaElement | null;
                    const csrfHeaderMeta = document.querySelector("meta[name='_csrf_header']") as HTMLMetaElement | null;
                    const csrfToken = csrfMeta?.content ?? "";
                    const csrfHeader = csrfHeaderMeta?.content ?? "CSRFToken";

                    const response = await fetch("cart/add?openFrom=SEARCH&recommendationType=AUTOCOMPLETE_LIST", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "x-requested-with": "XMLHttpRequest",
                            [csrfHeader]: csrfToken,
                        },
                        credentials: "include",
                        body: JSON.stringify({
                            productCodePost: runArgs.product_id,
                            productCode: runArgs.product_id,
                            sellingMethod: runArgs.sellingMethod,
                            qty: runArgs.qty,
                            frontQuantity: runArgs.qty,
                            comment: runArgs.comment || "",
                            affiliateCode: "",
                        }),
                    });

                    return {
                        ok: response.ok,
                        status: response.status,
                        redirected: response.redirected,
                        body: await response.text(),
                    };
                };

                const result = await executeScript(addToCartFunction, [{ product_id, sellingMethod, qty, comment }]);
                const response = result.result as { ok: boolean; status: number; redirected: boolean; body: string };
                const success = response.ok && !response.redirected;

                if (success) {
                    await page.reload({ waitUntil: "domcontentloaded" });
                }

                return {
                    content: [{
                        type: "text",
                        text: success
                            ? `Product successfully added to cart (status: ${response.status})`
                            : `Failed to add product to cart (status: ${response.status}, redirected: ${response.redirected})\nResponse: ${response.body.substring(0, 500)}`,
                    }],
                    isError: !success,
                };
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error adding to cart: ${(error as Error).message}`,
                    }],
                    isError: true,
                };
            }
        }
    );
};
