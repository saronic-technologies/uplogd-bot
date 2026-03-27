import {
  NAVCEN_BASE_URL,
  NAVCEN_DISTRICT,
  NAVCEN_MESSAGE_PATH,
  NAVCEN_PAGE_SIZE,
  NAVCEN_SAN_DIEGO_SECTOR,
  NAVCEN_SEARCH_PATH,
} from "./config.js";
import { extractLinks, extractNavcenMessageText } from "./html.js";

const NOTICE_ID_FROM_LINK_REGEX = /\b([A-Z]{2,}\s+[A-Z]{2,}\s+)?BNM\s+(\d{4}-\d{2})\b/i;

export function isLikelySummarySearchResult(result) {
  const text = `${result?.link_text ?? ""}`.toLowerCase();
  return text.includes("summary");
}

function buildUrl(pathname, params = {}) {
  const url = new URL(pathname, NAVCEN_BASE_URL);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });
  return url.toString();
}

function getDateRangeLabel(days) {
  if (days <= 30) {
    return "1 month ago--today";
  }
  if (days <= 60) {
    return "2 months ago--today";
  }
  return `${Math.ceil(days / 30)} months ago--today`;
}

function parseGuidFromHref(href = "") {
  try {
    const url = href.startsWith("http") ? new URL(href) : new URL(href, NAVCEN_BASE_URL);
    return url.searchParams.get("guid");
  } catch (error) {
    return null;
  }
}

async function fetchText(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    headers: { "user-agent": "uplogd-bot/0.1.0" },
  });
  if (!response.ok) {
    throw new Error(`Fetch failed (${response.status}) for ${url}`);
  }
  return response.text();
}

export class NavcenClient {
  constructor({ fetchImpl = fetch, logger } = {}) {
    this.fetchImpl = fetchImpl;
    this.logger = logger;
  }

  buildSearchResultsUrl({ days = 30, page = 0, pageSize = NAVCEN_PAGE_SIZE } = {}) {
    return buildUrl(NAVCEN_SEARCH_PATH, {
      "date-range": getDateRangeLabel(days),
      district: NAVCEN_DISTRICT,
      sector: NAVCEN_SAN_DIEGO_SECTOR,
      items_per_page: String(pageSize),
      order: "field_bnm_message_number",
      sort: "desc",
      page: String(page),
    });
  }

  buildMessageUrl(guid) {
    return buildUrl(NAVCEN_MESSAGE_PATH, { guid });
  }

  async fetchSearchResults({ days = 30, maxPages = 10 } = {}) {
    const results = [];
    const seenGuids = new Set();

    for (let page = 0; page < maxPages; page += 1) {
      const url = this.buildSearchResultsUrl({ days, page });
      this.logger?.info?.("Fetching NAVCEN search results page", {
        days,
        page,
        url,
      });
      const html = await fetchText(url, this.fetchImpl);
      const links = extractLinks(
        html,
        ({ href }) => href.includes(NAVCEN_MESSAGE_PATH)
      );

      const pageResults = links
        .map((link) => {
          const guid = parseGuidFromHref(link.href);
          if (!guid || seenGuids.has(guid)) {
            return null;
          }

          const noticeMatch = link.text.match(NOTICE_ID_FROM_LINK_REGEX);
          return {
            guid,
            url: this.buildMessageUrl(guid),
            link_text: link.text,
            notice_id: noticeMatch?.[2] ?? null,
            is_san_diego:
              /\bSEC SSD\b/i.test(link.text) || /\bSAN DIEGO\b/i.test(link.text),
          };
        })
        .filter(Boolean);

      pageResults.forEach((item) => {
        seenGuids.add(item.guid);
        results.push(item);
      });

      this.logger?.info?.("Fetched NAVCEN search results page", {
        days,
        page,
        pageResults: pageResults.length,
        totalResults: results.length,
      });

      if (pageResults.length < NAVCEN_PAGE_SIZE / 2) {
        break;
      }
    }

    return results;
  }

  async fetchSearchResultGuids({ days = 30, maxPages = 10 } = {}) {
    const results = await this.fetchSearchResults({ days, maxPages });
    return results.map((item) => item.guid);
  }

  async fetchMessageHtml(guid) {
    return fetchText(this.buildMessageUrl(guid), this.fetchImpl);
  }

  async fetchMessage(guid) {
    const url = this.buildMessageUrl(guid);
    this.logger?.info?.("Fetching NAVCEN message", { guid, url });
    const html = await fetchText(url, this.fetchImpl);
    return {
      guid,
      url,
      html,
      text: extractNavcenMessageText(html),
    };
  }

  async fetchMessages(guids = [], { concurrency = 6 } = {}) {
    this.logger?.info?.("Fetching NAVCEN messages batch", {
      count: guids.length,
      concurrency,
    });
    const results = [];
    const queue = [...guids];

    const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
      while (queue.length > 0) {
        const guid = queue.shift();
        if (!guid) {
          continue;
        }
        try {
          results.push(await this.fetchMessage(guid));
        } catch (error) {
          this.logger?.warn?.("Failed to fetch NAVCEN message", { guid, error });
        }
      }
    });

    await Promise.all(workers);
    return results;
  }
}
