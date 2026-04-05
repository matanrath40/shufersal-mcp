import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ensureBrowser, executeScript } from "../browser.js";

export const registerRemoveFromCartTool = (server: McpServer) => {
    server.registerTool(
        "remove_from_shufersal_cart",
        {
            description: "Remove a product from the shopping cart by product ID.",
            inputSchema: {
                product_id: z.string().describe("Product ID to remove from cart"),
            }
        },
        async ({ product_id }: { product_id: string }) => {
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

                const removeFromCart = async (productId: string) => {
                    const csrfMeta = document.querySelector("meta[name='_csrf']") as HTMLMetaElement | null;
                    const csrfHeaderMeta = document.querySelector("meta[name='_csrf_header']") as HTMLMetaElement | null;
                    const csrfToken = csrfMeta?.content ?? "";
                    const csrfHeader = csrfHeaderMeta?.content ?? "CSRFToken";

                    const response = await fetch("cart/remove", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "x-requested-with": "XMLHttpRequest",
                            [csrfHeader]: csrfToken,
                        },
                        credentials: "include",
                        body: JSON.stringify({
                            productCode: productId,
                        }),
                    });

                    return {
                        ok: response.ok,
                        status: response.status,
                        redirected: response.redirected,
                        body: await response.text(),
                    };
                };

                const result = await executeScript(removeFromCart, [product_id]);
                const response = result.result as { ok: boolean; status: number; redirected: boolean; body: string };

                // Success: ok, not redirected, and response body has empty error array
                let hasErrors = false;
                try {
                    const json = JSON.parse(response.body);
                    if (json.error && Array.isArray(json.error) && json.error.length > 0) {
                        hasErrors = true;
                    }
                } catch {
                    // non-JSON response, rely on status checks
                }
                const success = response.ok && !response.redirected && !hasErrors;

                if (success) {
                    await page.reload({ waitUntil: "domcontentloaded" });
                }

                return {
                    content: [{
                        type: "text",
                        text: success
                            ? `Product ${product_id} removed from cart`
                            : `Failed to remove product ${product_id} (status: ${response.status}, redirected: ${response.redirected})\nResponse: ${response.body.substring(0, 500)}`,
                    }],
                    isError: !success,
                };
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error removing from cart: ${(error as Error).message}`,
                    }],
                    isError: true,
                };
            }
        }
    );
};
