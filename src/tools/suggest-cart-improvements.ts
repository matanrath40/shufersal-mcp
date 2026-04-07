import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ensureBrowser, executeScript } from "../browser.js";
import { CONFIG } from "../config.js";
import { SearchApiResponse } from "../types.shufersal.js";

interface CartItem {
	name: string;
	price: string;
	quantity: string;
	productCode: string;
}

interface Suggestion {
	productName: string;
	productCode: string;
	currentQty: number;
	currentUnitPrice: number;
	promotionMsg: string;
	suggestedQty: number | null;
	estimatedSavings: string;
}

export const registerSuggestCartImprovementsTool = (server: McpServer) => {
	server.registerTool(
		"suggest_cart_improvements",
		{
			description:
				"Analyze current shopping cart and suggest improvements based on active promotions. " +
				"Checks each cart item for available deals (multi-buy, fixed price, etc.) and calculates potential savings.",
			inputSchema: {},
		},
		async () => {
			try {
				const page = await ensureBrowser();

				// Navigate to cart page to get current items
				await page.goto(`${CONFIG.SHUFERSAL_BASE_URL}cart`, { waitUntil: "domcontentloaded" });
				await page.waitForTimeout(CONFIG.DEFAULT_WAIT_TIMEOUT);

				const cartData = await page.evaluate(() => {
					const items: CartItem[] = [];
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
							quantity: qtyEl?.value || qtyEl?.textContent?.trim() || "1",
							productCode,
						});
					}

					const seen = new Set<string>();
					return items.filter(item => {
						if (!item.productCode || seen.has(item.productCode)) return false;
						seen.add(item.productCode);
						return true;
					});
				});

				if (cartData.length === 0) {
					return {
						content: [{
							type: "text" as const,
							text: "Cart is empty or could not be read. Please add items to your cart first.",
						}],
					};
				}

				// Navigate back to Shufersal main page for search API calls
				if (!page.url().includes("shufersal.co.il/online/he")) {
					await page.goto(CONFIG.SHUFERSAL_BASE_URL, { waitUntil: "domcontentloaded" });
					await page.waitForTimeout(CONFIG.DEFAULT_WAIT_TIMEOUT);
				}

				// Search for each cart item and check promotions
				const suggestions: Suggestion[] = [];

				for (const cartItem of cartData) {
					const searchFunction = async (runArgs: { query: string; baseUrl: string }) => {
						const urlObject = new URL(`${runArgs.baseUrl}search/results`);
						urlObject.searchParams.set("q", runArgs.query);
						urlObject.searchParams.set("limit", "10");

						const response = await fetch(urlObject.toString(), {
							headers: {
								"accept": "application/json",
								"x-requested-with": "XMLHttpRequest",
							},
							referrer: runArgs.baseUrl,
							referrerPolicy: "strict-origin-when-cross-origin",
							method: "GET",
							mode: "cors",
							credentials: "include",
						});

						return await response.json();
					};

					const result = await executeScript(searchFunction, [{
						query: cartItem.name,
						baseUrl: CONFIG.SHUFERSAL_BASE_URL,
					}]);

					const apiResponse = result.result as SearchApiResponse;
					if (!apiResponse?.results) continue;

					// Find matching product by code
					const match = apiResponse.results.find(r => r.code === cartItem.productCode);
					if (!match || !match.promotionMsg) continue;

					const currentQty = parseInt(cartItem.quantity) || 1;
					const unitPrice = match.price;
					const suggestion = parsePromotion(
						match.promotionMsg,
						cartItem.name,
						cartItem.productCode,
						currentQty,
						unitPrice,
					);

					if (suggestion) {
						suggestions.push(suggestion);
					}
				}

				if (suggestions.length === 0) {
					return {
						content: [{
							type: "text" as const,
							text: `Analyzed ${cartData.length} cart item(s). No promotion-based improvements found — your cart is already optimized!`,
						}],
					};
				}

				let text = `Found ${suggestions.length} suggestion(s) for ${cartData.length} cart item(s):\n\n`;
				for (const s of suggestions) {
					text += `**${s.productName}** [${s.productCode}]\n`;
					text += `  Promotion: ${s.promotionMsg}\n`;
					text += `  Current: ${s.currentQty} unit(s) at ₪${s.currentUnitPrice.toFixed(2)} each\n`;
					if (s.suggestedQty !== null) {
						text += `  Suggestion: Increase quantity to ${s.suggestedQty}\n`;
					}
					text += `  ${s.estimatedSavings}\n\n`;
				}

				return {
					content: [{
						type: "text" as const,
						text,
					}],
				};
			} catch (error) {
				return {
					content: [{
						type: "text" as const,
						text: `Error analyzing cart: ${(error as Error).message}`,
					}],
					isError: true,
				};
			}
		}
	);
};

function parsePromotion(
	promotionMsg: string,
	productName: string,
	productCode: string,
	currentQty: number,
	unitPrice: number,
): Suggestion | null {
	// Multi-buy: "2 יח'  ב- 40 ₪"
	const multiBuy = promotionMsg.match(/(\d+)\s*יח['׳]\s*ב-\s*([\d.]+)\s*₪/);
	if (multiBuy) {
		const requiredQty = parseInt(multiBuy[1]);
		const dealPrice = parseFloat(multiBuy[2]);
		const regularTotal = unitPrice * requiredQty;
		const savings = regularTotal - dealPrice;

		if (currentQty < requiredQty) {
			return {
				productName,
				productCode,
				currentQty,
				currentUnitPrice: unitPrice,
				promotionMsg,
				suggestedQty: requiredQty,
				estimatedSavings: `Potential savings: ₪${savings.toFixed(2)} if you buy ${requiredQty} instead of ${currentQty}`,
			};
		} else {
			// Already at or above the deal quantity — the deal should apply
			const setsInDeal = Math.floor(currentQty / requiredQty);
			const remainder = currentQty % requiredQty;
			const totalWithDeal = setsInDeal * dealPrice + remainder * unitPrice;
			const totalWithout = currentQty * unitPrice;
			const actualSavings = totalWithout - totalWithDeal;
			return {
				productName,
				productCode,
				currentQty,
				currentUnitPrice: unitPrice,
				promotionMsg,
				suggestedQty: null,
				estimatedSavings: `Deal is active! You save ₪${actualSavings.toFixed(2)} on your current ${currentQty} unit(s).`,
			};
		}
	}

	// Per-kg: "ב- 169 ₪ לק"ג"
	const perKg = promotionMsg.match(/ב-\s*([\d.]+)\s*₪\s*לק/);
	if (perKg) {
		const dealPricePerKg = parseFloat(perKg[1]);
		return {
			productName,
			productCode,
			currentQty,
			currentUnitPrice: unitPrice,
			promotionMsg,
			suggestedQty: null,
			estimatedSavings: `Special price: ₪${dealPricePerKg.toFixed(2)}/kg (regular: ₪${unitPrice.toFixed(2)})`,
		};
	}

	// Fixed price: "ב- 29.90 ₪"
	const fixedPrice = promotionMsg.match(/ב-\s*([\d.]+)\s*₪/);
	if (fixedPrice) {
		const dealPrice = parseFloat(fixedPrice[1]);
		const savings = unitPrice - dealPrice;
		if (savings > 0) {
			return {
				productName,
				productCode,
				currentQty,
				currentUnitPrice: unitPrice,
				promotionMsg,
				suggestedQty: null,
				estimatedSavings: `Deal price: ₪${dealPrice.toFixed(2)} (saves ₪${(savings * currentQty).toFixed(2)} total on ${currentQty} unit(s))`,
			};
		}
	}

	// Unrecognized promotion format — still report it
	return {
		productName,
		productCode,
		currentQty,
		currentUnitPrice: unitPrice,
		promotionMsg,
		suggestedQty: null,
		estimatedSavings: "Active promotion (format not parsed for savings calculation)",
	};
}
