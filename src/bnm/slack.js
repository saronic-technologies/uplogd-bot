import { PACIFIC_TIME_ZONE } from "./config.js";

function formatHeader(now = new Date()) {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TIME_ZONE,
    month: "short",
    day: "2-digit",
  }).format(now);
  return `San Diego Maritime Brief - 0900 PT (${day})`;
}

function locationLine(notice) {
  if (notice.relevance?.intersects_aoi) {
    return "Within Sector San Diego operating waters";
  }
  if (notice.relevance?.local_text_hint) {
    return "Local San Diego operating area mentioned";
  }
  return "Geometry unavailable";
}

function actionLine(notice) {
  const instruction = notice.instructions?.[0];
  if (instruction) {
    return instruction;
  }
  if (/div/i.test(notice.category ?? "")) {
    return "Action: Diver risk, remain clear.";
  }
  if (/haz/i.test(notice.category ?? "")) {
    return "Action: Avoid area and route around notice boundary.";
  }
  return "Action: Review full notice before launch.";
}

function formatNoticeLine(notice) {
  const until = notice.relevance?.until_local
    ? `Active until ${notice.relevance.until_local}`
    : "Active window not parsed";
  return [
    `- ${notice.notice_id} ${notice.category ?? "Notice"}`,
    `  ${locationLine(notice)}`,
    `  ${until}`,
    `  ${actionLine(notice)}`,
  ].join("\n");
}

export function buildSlackBrief({ filtered, summary, mapPath, now = new Date() }) {
  const lines = [formatHeader(now), ""];

  lines.push("HIGH PRIORITY");
  if (filtered.high_priority.length === 0) {
    lines.push("- No high-priority BNMs intersecting the mission AOI.");
  } else {
    filtered.high_priority.forEach((notice) => lines.push(formatNoticeLine(notice)));
  }

  lines.push("");
  lines.push("BACKGROUND");
  if (filtered.background.length === 0) {
    lines.push("- No additional local BNMs flagged for the mission window.");
  } else {
    filtered.background.forEach((notice) => lines.push(formatNoticeLine(notice)));
  }

  if (filtered.unparsed.length > 0) {
    lines.push("");
    lines.push("UNPARSED / CHECK RAW");
    filtered.unparsed.forEach((notice) => {
      lines.push(
        `- ${notice.notice_id ?? "Unknown"} ${notice.category ?? "Notice"} (${(
          notice.parse_warnings ?? []
        ).join(", ")})`
      );
    });
  }

  lines.push("");
  lines.push(
    `Source snapshot: ${summary.as_of_zulu ?? "as-of not parsed"} from latest SEC SSD summary`
  );
  if (mapPath) {
    lines.push(`Map: ${mapPath}`);
  }

  return lines.join("\n");
}
