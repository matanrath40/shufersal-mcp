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
                await ensureBrowser();

                const addToCartFunction = async (runArgs: { product_id: string, sellingMethod: string, qty: number, comment?: string }) => {
                    const url = "/cart/add?openFrom=SEARCH&recommendationType=AUTOCOMPLETE_LIST";
                    const response = await fetch(url, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "x-requested-with": "XMLHttpRequest",
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
                        body: await response.text(),
                    };
                };

                const result = await executeScript(addToCartFunction, [{ product_id, sellingMethod, qty, comment }]);
                const response = result.result as { ok: boolean; status: number; body: string };
                const success = response.ok;

                return {
                    content: [{
                        type: "text",
                        text: success
                            ? `Product successfully added to cart (status: ${response.status})`
                            : `Failed to add product to cart (status: ${response.status})\nResponse: ${response.body.substring(0, 500)}`,
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
