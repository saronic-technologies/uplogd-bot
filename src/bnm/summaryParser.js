import { splitLines } from "./html.js";

const ID_REGEX = /\b(\d{4}-\d{2})\b/g;
const AS_OF_REGEX =
  /(AS OF|EFFECTIVE AS OF)\s+(\d{6}Z\s+[A-Z]{3}\s+\d{2,4})/i;

function parsePublishedAt(text) {
  const match = text.match(
    /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\s+\d{2}:\d{2}:\d{2}\s+[+-]\d{4}\b/
  );
  if (!match) {
    return null;
  }
  const parsed = new Date(match[0]);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseAsOfZulu(text) {
  const match = text.match(AS_OF_REGEX);
  if (!match) {
    return null;
  }
  return match[2].toUpperCase();
}

function parseOriginator(lines) {
  const line =
    lines.find((item) => /message originator/i.test(item)) ||
    lines.find((item) => /sec ssd/i.test(item)) ||
    lines[0] ||
    null;

  if (!line) {
    return null;
  }

  const originatorMatch = line.match(/message originator[: ]+(.+)$/i);
  return (originatorMatch ? originatorMatch[1] : line).trim();
}

export function extractNoticeIds(text = "") {
  ID_REGEX.lastIndex = 0;
  const ids = new Set();
  let match = ID_REGEX.exec(text);
  while (match) {
    ids.add(match[1]);
    match = ID_REGEX.exec(text);
  }
  return [...ids];
}

export function parseSummaryMessage(message) {
  const text = message?.text ?? "";
  const lines = splitLines(text);
  const lowerText = text.toLowerCase();
  const stillInEffectIndex = lines.findIndex((line) =>
    /still in effect/i.test(line)
  );
  const cancellationIndex = lines.findIndex((line) =>
    /all others? (are )?cancelled/i.test(line)
  );
  const activeSectionLines =
    stillInEffectIndex >= 0
      ? lines.slice(
          stillInEffectIndex,
          cancellationIndex > stillInEffectIndex ? cancellationIndex : undefined
        )
      : lines;
  const activeNoticeIds = extractNoticeIds(activeSectionLines.join("\n"));

  return {
    guid: message?.guid ?? null,
    url: message?.url ?? null,
    originator: parseOriginator(lines),
    published_at: parsePublishedAt(text),
    as_of_zulu: parseAsOfZulu(text),
    active_notice_ids: activeNoticeIds,
    is_full_state_snapshot:
      /all others? (are )?cancelled/i.test(text) ||
      /all other broadcast notice to mariners/i.test(lowerText),
    raw_text: text,
  };
}

export function isLikelySummaryMessage(message) {
  const text = (message?.text ?? "").toLowerCase();
  return (
    text.includes("summary") &&
    text.includes("still in effect") &&
    text.includes("sec ssd")
  );
}
