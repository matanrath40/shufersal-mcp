import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ensureBrowser, executeScript } from "../browser.js";
import { CONFIG } from "../config.js";
import { SearchApiResponse, PromoPageItem } from "../types.shufersal.js";

export const registerFindPromotionsTool = (server: McpServer) => {
	server.registerTool(
		"find_shufersal_promotions",
		{
			description:
				"Find current promotions and deals on Shufersal. " +
				"Two modes: (1) browse the promotions page (no query), or " +
				"(2) search for products and filter to only those with active promotions (with query).",
			inputSchema: {
				category: z.string().optional().describe(
					"Category filter code for browsing promotions page (e.g. 'A31' for פארם וטיפוח). Only used when no query is provided."
				),
				page: z.number().optional().default(0).describe(
					"Page number (0-indexed, ~20 items per page). Only used when browsing promotions page."
				),
				query: z.string().optional().describe(
					"If provided, searches for products and returns only those with active promotions."
				),
			},
		},
		async ({ category, page, query }: { category?: string; page: number; query?: string }) => {
			try {
				const browserPage = await ensureBrowser();
				const currentUrl = browserPage.url();

				if (!currentUrl.includes("shufersal")) {
					return {
						content: [{
							type: "text" as const,
							text: "Please open the Shufersal website first using the 'open_shufersal' tool",
						}],
						isError: true,
					};
				}

				// Mode B: Search with promo filter
				if (query) {
					return await searchWithPromoFilter(query);
				}

				// Mode A: Browse promo page
				return await browsePromoPage(page, category);
			} catch (error) {
				return {
					content: [{
						type: "text" as const,
						text: `Error finding promotions: ${(error as Error).message}`,
					}],
					isError: true,
				};
			}
		}
	);
};

async function searchWithPromoFilter(query: string) {
	const searchFunction = async (runArgs: { query: string; baseUrl: string; searchLimit: number }) => {
		const urlObject = new URL(`${runArgs.baseUrl}search/results`);
		urlObject.searchParams.set("q", runArgs.query);
		urlObject.searchParams.set("limit", runArgs.searchLimit.toString());

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
		query,
		baseUrl: CONFIG.SHUFERSAL_BASE_URL,
		searchLimit: CONFIG.SEARCH_ITEMS_LIMIT,
	}]);
	const apiResponse = result.result as SearchApiResponse;

	if (!apiResponse?.results) {
		return {
			content: [{
				type: "text" as const,
				text: `No results found for query: ${query}`,
			}],
		};
	}

	const promoItems = apiResponse.results.filter(item => item.promotionMsg !== null);

	if (promoItems.length === 0) {
		return {
			content: [{
				type: "text" as const,
				text: `No promotions found for "${query}". Found ${apiResponse.results.length} products but none have active promotions.`,
			}],
		};
	}

	const items = promoItems.map(item => ({
		code: item.code,
		name: item.name,
		price: item.price,
		brandName: item.brandName,
		promotionMsg: item.promotionMsg,
		mainPromotionCode: item.mainPromotionCode,
	}));

	return {
		content: [{
			type: "text" as const,
			text: `Found ${items.length} product(s) with promotions for "${query}":\n${JSON.stringify(items, null, 2)}`,
		}],
	};
}

async function browsePromoPage(page: number, category?: string) {
	const fetchPromoPage = async (runArgs: { baseUrl: string; page: number; category?: string }) => {
		let qParam = ":relevance";
		if (runArgs.category) {
			qParam += `:categories-2:${runArgs.category}`;
		}

		const url = `${runArgs.baseUrl}promo/A/fragment?q=${encodeURIComponent(qParam)}&page=${runArgs.page}`;
		const response = await fetch(url, {
			headers: {
				"x-requested-with": "XMLHttpRequest",
			},
			credentials: "include",
		});

		return await response.text();
	};

	const result = await executeScript(fetchPromoPage, [{
		baseUrl: CONFIG.SHUFERSAL_BASE_URL,
		page,
		category,
	}]);

	const html = result.result as string;

	// Parse pagination from root div attributes
	const totalResultsMatch = html.match(/data-results="(\d+)"/);
	const totalPagesMatch = html.match(/data-pages="(\d+)"/);
	const hasNextMatch = html.match(/data-has-next-pagge="(true|false)"/);

	const totalResults = totalResultsMatch ? parseInt(totalResultsMatch[1]) : 0;
	const totalPages = totalPagesMatch ? parseInt(totalPagesMatch[1]) : 0;
	const hasNext = hasNextMatch ? hasNextMatch[1] === "true" : false;

	// Parse promo items from HTML
	const items: PromoPageItem[] = [];

	// Split by promo cards — each card has data-promo attribute
	const cardMatches = html.matchAll(/data-promo="([^"]*)"[^>]*data-product-code="([^"]*)"/g);
	const cards = [...cardMatches];

	for (const card of cards) {
		const promoId = card[1];
		const productCode = card[2];

		// Find the surrounding context for this card to extract details
		const cardStart = card.index!;
		// Get a chunk of HTML after this card's opening tag
		const chunk = html.substring(cardStart, cardStart + 2000);

		const descMatch = chunk.match(/<!--begin:buyDescription-->([\s\S]*?)<!--end:buyDescription-->/);
		const qtyMatch = chunk.match(/<!--begin:QuantityCond-->([\s\S]*?)<!--end:QuantityCond-->/);
		const priceMatch = chunk.match(/class="number"[^>]*>([\s\S]*?)<\/span>/);

		items.push({
			promoId,
			productCode,
			description: descMatch ? descMatch[1].replace(/<[^>]*>/g, "").trim() : "",
			quantityCondition: qtyMatch ? qtyMatch[1].replace(/<[^>]*>/g, "").trim() : "",
			priceText: priceMatch ? priceMatch[1].trim() + " ₪" : "",
		});
	}

	let text = `Promotions page ${page + 1}/${totalPages} (${totalResults} total promotions):\n\n`;

	if (items.length === 0) {
		text += "No promotions found on this page. The page HTML structure may have changed.";
	} else {
		for (const item of items) {
			text += `- ${item.description}`;
			if (item.quantityCondition) text += ` | ${item.quantityCondition}`;
			if (item.priceText) text += ` ב- ${item.priceText}`;
			if (item.productCode) text += ` [${item.productCode}]`;
			text += ` (promo: ${item.promoId})`;
			text += "\n";
		}
	}

	if (hasNext) {
		text += `\nMore pages available. Use page=${page + 1} to see the next page.`;
	}

	return {
		content: [{
			type: "text" as const,
			text,
		}],
	};
}
