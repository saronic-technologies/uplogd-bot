import { NAVCEN_RSS_URL } from "./config.js";
import { decodeHtmlEntities } from "./html.js";

function getTagValue(block, tagName) {
  const match = block.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? decodeHtmlEntities(match[1].trim()) : null;
}

export async function fetchRssItems({
  url = NAVCEN_RSS_URL,
  fetchImpl = fetch,
} = {}) {
  const response = await fetchImpl(url, {
    headers: { "user-agent": "uplogd-bot/0.1.0" },
  });

  if (!response.ok) {
    throw new Error(`RSS fetch failed: ${response.status}`);
  }

  const xml = await response.text();
  const items = [];
  const regex = /<item>([\s\S]*?)<\/item>/gi;
  let match = regex.exec(xml);
  while (match) {
    const block = match[1];
    items.push({
      title: getTagValue(block, "title"),
      link: getTagValue(block, "link"),
      guid: getTagValue(block, "guid"),
      published_at: getTagValue(block, "pubDate"),
    });
    match = regex.exec(xml);
  }

  return items;
}
