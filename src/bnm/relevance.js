import {
  DEFAULT_AOI,
  DEFAULT_MISSION_WINDOW,
  HIGH_PRIORITY_KEYWORDS,
  LOCAL_RELEVANCE_KEYWORDS,
  PACIFIC_TIME_ZONE,
} from "./config.js";

function getTimeZoneParts(date = new Date(), timeZone = PACIFIC_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = formatter
    .formatToParts(date)
    .filter((part) => part.type !== "literal")
    .reduce((acc, part) => ({ ...acc, [part.type]: Number(part.value) }), {});

  return parts;
}

function getTimeZoneOffsetMs(timeZone, date = new Date()) {
  const parts = getTimeZoneParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0
  );
  return asUtc - date.getTime();
}

function zonedDate(timeZone, parts) {
  const utcGuess = Date.UTC(
    parts.year,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0
  );
  const offset = getTimeZoneOffsetMs(timeZone, new Date(utcGuess));
  return new Date(utcGuess - offset);
}

function missionWindowForDate(date = new Date(), windowConfig = DEFAULT_MISSION_WINDOW) {
  const parts = getTimeZoneParts(date, PACIFIC_TIME_ZONE);
  const start = zonedDate(PACIFIC_TIME_ZONE, {
    ...parts,
    hour: windowConfig.startHour,
    minute: 0,
    second: 0,
  });
  const end = new Date(start.getTime() + windowConfig.durationHours * 60 * 60 * 1000);
  return { start, end };
}

function bboxFromGeometry(geometry) {
  if (!geometry?.coordinates?.[0]?.length) {
    return null;
  }
  const coordinates = geometry.coordinates[0];
  const lons = coordinates.map(([lon]) => lon);
  const lats = coordinates.map(([, lat]) => lat);
  return {
    minLon: Math.min(...lons),
    maxLon: Math.max(...lons),
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
  };
}

function bboxesIntersect(a, b) {
  if (!a || !b) {
    return false;
  }
  return !(
    a.maxLon < b.minLon ||
    a.minLon > b.maxLon ||
    a.maxLat < b.minLat ||
    a.minLat > b.maxLat
  );
}

function isActiveDuringMission(notice, window) {
  const start = notice.effective_start_zulu ? new Date(notice.effective_start_zulu) : null;
  const end = notice.effective_end_zulu
    ? new Date(notice.effective_end_zulu)
    : notice.cancel_at_zulu
    ? new Date(notice.cancel_at_zulu)
    : null;

  if (!start && !end) {
    return true;
  }
  if (start && start > window.end) {
    return false;
  }
  if (end && end < window.start) {
    return false;
  }
  return true;
}

function localTextHint(notice) {
  const haystack = `${notice.category ?? ""} ${notice.raw_body ?? ""}`.toLowerCase();
  return LOCAL_RELEVANCE_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

function highPriorityHint(notice) {
  const haystack = `${notice.category ?? ""} ${notice.raw_body ?? ""}`.toLowerCase();
  return HIGH_PRIORITY_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

function formatUntil(notice) {
  const until = notice.effective_end_zulu || notice.cancel_at_zulu;
  if (!until) {
    return null;
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(until));
}

export function classifyNotice(
  notice,
  { aoi = DEFAULT_AOI, missionWindow = missionWindowForDate() } = {}
) {
  const bbox = bboxFromGeometry(notice.geometry);
  const intersectsAoi = bbox ? bboxesIntersect(bbox, aoi.extent) : false;
  const missionActive = isActiveDuringMission(notice, missionWindow);
  const localHint = localTextHint(notice);
  const geometryUnavailable = notice.parse_warnings?.includes("geometry_unavailable");

  let bucket = "out_of_area";
  if (!notice.notice_id) {
    bucket = "unparsed";
  } else if (notice.parse_warnings?.includes("resolution_missing")) {
    bucket = "unparsed";
  } else if (geometryUnavailable && !localHint) {
    bucket = "unparsed";
  } else if ((intersectsAoi || localHint) && missionActive) {
    bucket = highPriorityHint(notice) ? "high_priority" : "background";
  } else if (intersectsAoi || localHint) {
    bucket = "background";
  }

  return {
    ...notice,
    relevance: {
      bucket,
      intersects_aoi: intersectsAoi,
      mission_active: missionActive,
      geometry_available: !geometryUnavailable,
      local_text_hint: localHint,
      high_priority_hint: highPriorityHint(notice),
      until_local: formatUntil(notice),
    },
  };
}

export function filterNotices(
  notices,
  { aoi = DEFAULT_AOI, missionWindow } = {}
) {
  const effectiveMissionWindow = missionWindow ?? missionWindowForDate();
  const classified = notices.map((notice) =>
    classifyNotice(notice, {
      aoi,
      missionWindow: effectiveMissionWindow,
    })
  );

  return {
    high_priority: classified.filter((item) => item.relevance.bucket === "high_priority"),
    background: classified.filter((item) => item.relevance.bucket === "background"),
    out_of_area: classified.filter((item) => item.relevance.bucket === "out_of_area"),
    unparsed: classified.filter((item) => item.relevance.bucket === "unparsed"),
    all: classified,
    mission_window: {
      start: effectiveMissionWindow.start.toISOString(),
      end: effectiveMissionWindow.end.toISOString(),
    },
  };
}
