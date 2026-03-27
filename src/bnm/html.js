export function decodeHtmlEntities(value = "") {
  return String(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function stripHtml(html = "") {
  return decodeHtmlEntities(String(html))
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function extractNavcenMessageText(html = "") {
  const normalized = String(html);
  const startMarkers = [
    "District 11 Broadcast Notice to Mariners Message",
    "Broadcast Notice to Mariners Message",
    "Message Originator:",
  ];

  let sliced = normalized;
  for (const marker of startMarkers) {
    const index = normalized.indexOf(marker);
    if (index >= 0) {
      sliced = normalized.slice(index);
      break;
    }
  }

  const text = stripHtml(sliced);
  const btIndex = text.lastIndexOf("\n BT");
  if (btIndex >= 0) {
    return text.slice(0, btIndex + 4).trim();
  }
  return text;
}

export function splitLines(text = "") {
  return String(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function extractLinks(html = "", matcher) {
  const matches = [];
  const regex = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match = regex.exec(html);
  while (match) {
    const href = decodeHtmlEntities(match[1]);
    const text = stripHtml(match[2]);
    if (!matcher || matcher({ href, text })) {
      matches.push({ href, text });
    }
    match = regex.exec(html);
  }
  return matches;
}
