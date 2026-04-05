import { z } from "zod";
import TurndownService from "turndown";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ensureBrowser, browserState } from "../browser.js";

export const registerReadWebpageContentTool = (server: McpServer) => {
    server.registerTool(
        "read_webpage_content",
        {
            description: "Fetch the content of a webpage and convert it to markdown format. " +
                "Useful for reading recipe pages or shopping lists before creating a shopping list table.",
            inputSchema: {
                url: z.string().describe("URL of the webpage to fetch and convert to markdown")
            }
        },
        async ({ url }: { url: string }) => {
            await ensureBrowser();
            const tempPage = await browserState.context!.newPage();
            try {
                const response = await tempPage.goto(url, { waitUntil: "domcontentloaded" });

                if (!response?.ok()) {
                    return {
                        content: [{
                            type: "text",
                            text: `Failed to navigate to ${url}. Status: ${response?.status()}`,
                        }],
                        isError: true,
                    };
                }

                const html = await tempPage.content();
                const turndownService = new TurndownService();
                const content = turndownService
                    .remove("script")
                    .remove("style")
                    .turndown(html);

                return {
                    content: [{
                        type: "text",
                        text: content,
                    }],
                    isError: false,
                };
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error reading webpage: ${(error as Error).message}`,
                    }],
                    isError: true,
                };
            } finally {
                await tempPage.close();
            }
        }
    );
};
