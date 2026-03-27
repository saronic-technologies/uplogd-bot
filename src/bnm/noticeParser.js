import { splitLines } from "./html.js";

const MONTHS = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
};

const DMS_COORDINATE_REGEX =
  /(\d{2})-(\d{2})-(\d{2})\s*([NS])[\s,;/]+(\d{3})-(\d{2})-(\d{2})\s*([EW])/gi;
const DM_COORDINATE_REGEX =
  /(\d{2})-(\d{2}(?:\.\d+)?)\s*([NS])[A-Z0-9]*[\s,;/]+(\d{3})-(\d{2}(?:\.\d+)?)\s*([EW])[A-Z0-9]*/gi;
const DEGREE_DECIMAL_MINUTE_COORDINATE_REGEX =
  /(\d{2})\s+DEGREES\s+(\d{1,2})\s+DECIMAL\s+(\d{1,3})\s+MINUTES\s*([NS])\s+BY\s+(\d{3})\s+DEGREES\s+(\d{1,3})\s+DECIMAL\s+(\d{1,3})\s+MINUTES\s*([EW])/gi;
const DM_SHORT_COORDINATE_REGEX =
  /(\d{2})-(\d{2})\s*([NS])[\s,;/]+(\d{3})-(\d{2})\s*([EW])/gi;
const RADIUS_CENTER_REGEX =
  /(\d+(?:\.\d+)?)\s*(YARD|YARDS|YD|YDS|NAUTICAL MILE|NAUTICAL MILES|NM)\s+RADIUS\s+OF\s+POSN\s+(\d{2})-(\d{2}(?:\.\d+)?)\s*([NS])[A-Z0-9]*[\s,;/]+(\d{3})-(\d{2}(?:\.\d+)?)\s*([EW])[A-Z0-9]*/i;
const SINGLE_POINT_DM_REGEX =
  /(?:VICINITY OF|POSN|POSITION)\s+(\d{2})-(\d{2}(?:\.\d+)?)\s*([NS])[A-Z0-9]*[\s,;/]+(\d{3})-(\d{2}(?:\.\d+)?)\s*([EW])[A-Z0-9]*/i;
const CLEAR_RADIUS_REGEX =
  /(ONE|1)\s+NAUTICAL\s+MILE\s+CLEAR/i;

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

function dmsToDecimal(degrees, minutes, seconds, hemisphere) {
  const absolute =
    Number(degrees) + Number(minutes) / 60 + Number(seconds) / 3600;
  if (["S", "W"].includes(String(hemisphere).toUpperCase())) {
    return -absolute;
  }
  return absolute;
}

function dmToDecimal(degrees, minutes, hemisphere) {
  const absolute = Number(degrees) + Number(minutes) / 60;
  if (["S", "W"].includes(String(hemisphere).toUpperCase())) {
    return -absolute;
  }
  return absolute;
}

function normalizeText(text = "") {
  return String(text).replace(/\s+/g, " ").trim();
}

function parseHeader(text) {
  const lines = splitLines(text);
  const headerLine =
    lines.find((line) => /\bBNM\s+\d{4}-\d{2}\b/i.test(line)) || lines[0] || "";
  const parts = headerLine
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  const noticeIdMatch =
    headerLine.match(/\bBNM\s+(\d{4}-\d{2})\b/i) ||
    headerLine.match(/\b(\d{4}-\d{2})\b/);

  return {
    notice_id: noticeIdMatch?.[1] ?? null,
    criticality: parts[0] ?? null,
    region: parts[1] ?? null,
    category: parts[2] ?? null,
    originator: parts[3]?.replace(/\bBNM\s+\d{4}-\d{2}\b/i, "").trim() ?? null,
  };
}

function parseDtgToken(token) {
  if (!token) {
    return null;
  }

  const match = String(token)
    .trim()
    .toUpperCase()
    .match(/^(\d{2})(\d{2})(\d{2})Z\s+([A-Z]{3})\s+(\d{2,4})$/);
  if (!match) {
    return null;
  }

  const [, day, hour, minute, monthRaw, yearRaw] = match;
  const month = MONTHS[monthRaw];
  if (month === undefined) {
    return null;
  }
  const year =
    yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw);

  return new Date(Date.UTC(year, month, Number(day), Number(hour), Number(minute))).toISOString();
}

function parseEffectiveWindow(text) {
  const match = text.match(
    /(\d{6}Z\s+[A-Z][a-z]{2}\s+\d{2,4})\s+TO\s+(\d{6}Z\s+[A-Z][a-z]{2}\s+\d{2,4})/i
  );

  if (!match) {
    return { effective_start_zulu: null, effective_end_zulu: null };
  }

  return {
    effective_start_zulu: parseDtgToken(match[1]),
    effective_end_zulu: parseDtgToken(match[2]),
  };
}

function parseCancelAt(text) {
  const match = text.match(/CANCEL AT\/\/\s*([^/]+?)\s*\/\//i);
  if (!match) {
    return null;
  }
  return parseDtgToken(match[1]);
}

function parseInstructions(text) {
  const sentences = normalizeText(text)
    .split(/(?<=[.?!])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return sentences.filter((sentence) =>
    /(avoid|remain clear|use caution|keep clear|do not enter|diver|hazard)/i.test(
      sentence
    )
  );
}

function parseDmsCoordinates(text) {
  const points = [];
  DMS_COORDINATE_REGEX.lastIndex = 0;
  let match = DMS_COORDINATE_REGEX.exec(text);
  while (match) {
    const lat = dmsToDecimal(match[1], match[2], match[3], match[4]);
    const lon = dmsToDecimal(match[5], match[6], match[7], match[8]);
    points.push([lon, lat]);
    match = DMS_COORDINATE_REGEX.exec(text);
  }
  return points;
}

function parseDmCoordinates(text) {
  const points = [];
  DM_COORDINATE_REGEX.lastIndex = 0;
  let match = DM_COORDINATE_REGEX.exec(text);
  while (match) {
    const lat = dmToDecimal(match[1], match[2], match[3]);
    const lon = dmToDecimal(match[4], match[5], match[6]);
    points.push([lon, lat]);
    match = DM_COORDINATE_REGEX.exec(text);
  }
  return points;
}

function parseShortDmCoordinates(text) {
  const points = [];
  DM_SHORT_COORDINATE_REGEX.lastIndex = 0;
  let match = DM_SHORT_COORDINATE_REGEX.exec(text);
  while (match) {
    const lat = dmToDecimal(match[1], match[2], match[3]);
    const lon = dmToDecimal(match[4], match[5], match[6]);
    points.push([lon, lat]);
    match = DM_SHORT_COORDINATE_REGEX.exec(text);
  }
  return points;
}

function parseDegreeDecimalMinuteCoordinates(text) {
  const points = [];
  DEGREE_DECIMAL_MINUTE_COORDINATE_REGEX.lastIndex = 0;
  let match = DEGREE_DECIMAL_MINUTE_COORDINATE_REGEX.exec(text);
  while (match) {
    const latMinutes = `${match[2]}.${match[3]}`;
    const lonMinutes = `${match[6]}.${match[7]}`;
    const lat = dmToDecimal(match[1], latMinutes, match[4]);
    const lon = dmToDecimal(match[5], lonMinutes, match[8]);
    points.push([lon, lat]);
    match = DEGREE_DECIMAL_MINUTE_COORDINATE_REGEX.exec(text);
  }
  return points;
}

function buildPolygonGeometry(points) {
  if (points.length < 3) {
    return null;
  }

  const ring = [...points];
  const [firstLon, firstLat] = ring[0];
  const [lastLon, lastLat] = ring[ring.length - 1];
  if (firstLon !== lastLon || firstLat !== lastLat) {
    ring.push([firstLon, firstLat]);
  }

  return {
    type: "Polygon",
    coordinates: [ring],
  };
}

function radiusToNauticalMiles(value, unit) {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return null;
  }
  const upper = String(unit).toUpperCase();
  if (upper.startsWith("YARD") || upper === "YD" || upper === "YDS") {
    return numeric / 2025.37183;
  }
  return numeric;
}

function buildCirclePolygon(centerLon, centerLat, radiusNm, segments = 24) {
  const points = [];
  const latRadians = (centerLat * Math.PI) / 180;
  const radiusLatDegrees = radiusNm / 60;
  const radiusLonDegrees = radiusNm / (60 * Math.cos(latRadians) || 1);

  for (let index = 0; index < segments; index += 1) {
    const angle = (2 * Math.PI * index) / segments;
    const lat = centerLat + radiusLatDegrees * Math.sin(angle);
    const lon = centerLon + radiusLonDegrees * Math.cos(angle);
    points.push([lon, lat]);
  }
  points.push(points[0]);
  return {
    type: "Polygon",
    coordinates: [points],
  };
}

function parseRadiusGeometry(text) {
  const match = text.match(RADIUS_CENTER_REGEX);
  if (!match) {
    return null;
  }

  const radiusNm = radiusToNauticalMiles(match[1], match[2]);
  if (!radiusNm) {
    return null;
  }

  const centerLat = dmToDecimal(match[3], match[4], match[5]);
  const centerLon = dmToDecimal(match[6], match[7], match[8]);
  return buildCirclePolygon(centerLon, centerLat, radiusNm);
}

function parseImplicitClearAreaGeometry(text) {
  const pointMatch = text.match(SINGLE_POINT_DM_REGEX);
  if (!pointMatch) {
    return null;
  }

  const centerLat = dmToDecimal(pointMatch[1], pointMatch[2], pointMatch[3]);
  const centerLon = dmToDecimal(pointMatch[4], pointMatch[5], pointMatch[6]);

  if (CLEAR_RADIUS_REGEX.test(text)) {
    return buildCirclePolygon(centerLon, centerLat, 1);
  }

  return {
    type: "Point",
    coordinates: [centerLon, centerLat],
  };
}

function parseGeometry(text) {
  const normalized = normalizeText(text).toUpperCase();
  const radiusGeometry = parseRadiusGeometry(normalized);
  if (radiusGeometry) {
    return radiusGeometry;
  }

  const implicitGeometry = parseImplicitClearAreaGeometry(normalized);
  if (implicitGeometry?.type === "Polygon") {
    return implicitGeometry;
  }

  const parsers = [
    parseDmsCoordinates,
    parseDegreeDecimalMinuteCoordinates,
    parseDmCoordinates,
    parseShortDmCoordinates,
  ];

  for (const parser of parsers) {
    const geometry = buildPolygonGeometry(parser(normalized));
    if (geometry) {
      return geometry;
    }
  }

  return null;
}

export function parseNoticeMessage(message) {
  const text = message?.text ?? "";
  const header = parseHeader(text);
  const warnings = [];
  const { effective_start_zulu, effective_end_zulu } = parseEffectiveWindow(text);
  const cancel_at_zulu = parseCancelAt(text);
  const geometry = parseGeometry(text);

  if (!header.notice_id) {
    warnings.push("notice_id_not_found");
  }
  if (!message?.guid) {
    warnings.push("guid_unavailable");
  }
  if (!geometry) {
    warnings.push("geometry_unavailable");
  }
  if (!effective_start_zulu && !effective_end_zulu && !cancel_at_zulu) {
    warnings.push("time_window_unavailable");
  }

  return {
    notice_id: header.notice_id,
    category: header.category,
    region: header.region,
    criticality: header.criticality,
    originator: header.originator,
    published_at: parsePublishedAt(text),
    effective_start_zulu,
    effective_end_zulu,
    cancel_at_zulu,
    instructions: parseInstructions(text),
    geometry,
    raw_body: text,
    parse_warnings: warnings,
    guid: message?.guid ?? null,
    url: message?.url ?? null,
  };
}
