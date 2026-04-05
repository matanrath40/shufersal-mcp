import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ensureBrowser, executeScript } from "../browser.js";

export const registerCheckLoginStatusTool = (server: McpServer) => {
    server.registerTool(
        "check_shufersal_login",
        {
            description: "Check if the user is currently logged in to Shufersal. Should be called before cart operations.",
            inputSchema: {}
        },
        async () => {
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

                const checkLogin = async () => {
                    // Shufersal shows an account button with the user's name when logged in,
                    // and a login button with "הזדהות כלקוח פרטי" when logged out.
                    const accountBtn = document.querySelector("a[href*='my-account'], a[href*='account'], .my-account");
                    const loginBtn = document.querySelector("a[href*='login'], button[class*='login'], .login-btn, .sign-in-btn");

                    if (accountBtn) {
                        const name = accountBtn.textContent?.trim() || null;
                        return { loggedIn: true, userName: name };
                    }

                    if (loginBtn) {
                        return { loggedIn: false, userName: null };
                    }

                    return { loggedIn: false, userName: null };
                };

                const result = await executeScript(checkLogin, []);
                const status = result.result as { loggedIn: boolean; userName: string | null };

                return {
                    content: [{
                        type: "text",
                        text: status.loggedIn
                            ? `Logged in as: ${status.userName}`
                            : "Not logged in. Please log in manually in the browser window before performing cart operations.",
                    }],
                };
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error checking login status: ${(error as Error).message}`,
                    }],
                    isError: true,
                };
            }
        }
    );
};
