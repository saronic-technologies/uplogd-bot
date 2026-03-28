import path from "node:path";
import { DEFAULT_AOI, DEFAULT_SEARCH_WINDOWS_DAYS, DEFAULT_STORE_DIR } from "./config.js";
import { generateMapImage } from "./map.js";
import { NavcenClient } from "./navcenClient.js";
import { parseNoticeMessage } from "./noticeParser.js";
import { filterNotices } from "./relevance.js";
import { buildSlackBrief } from "./slack.js";
import { StoreManager } from "./store.js";
import { isLikelySummaryMessage, parseSummaryMessage } from "./summaryParser.js";

function dateKeyForPacific(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function buildResolutionIndexFromSearchResults(results) {
  const index = {};
  results.forEach((result) => {
    if (!result.notice_id) {
      return;
    }

    const existing = index[result.notice_id];
    const prefersCurrent = !existing || result.is_san_diego;
    if (!prefersCurrent) {
      return;
    }

    index[result.notice_id] = {
      guid: result.guid,
      url: result.url,
      published_at: null,
      source: "search_results",
    };
  });
  return index;
}

function limitIndexToNoticeIds(index, noticeIds) {
  const limited = {};
  noticeIds.forEach((noticeId) => {
    if (index[noticeId]) {
      limited[noticeId] = index[noticeId];
    }
  });
  return limited;
}

function uniqueWindows(windows) {
  return [...new Set(windows)];
}

function isParsedNoticeUsable(parsedNotice, noticeId, guid) {
  if (!parsedNotice || parsedNotice.guid !== guid) {
    return false;
  }

  if (parsedNotice.notice_id !== noticeId) {
    return false;
  }

  return true;
}

function normalizeParsedNotice(parsedNotice, noticeId) {
  return {
    ...parsedNotice,
    notice_id: parsedNotice.notice_id ?? noticeId,
  };
}

async function findLatestSummary({
  navcen,
  logger,
}) {
  const summaryWindows = [7, 14];

  for (const windowDays of summaryWindows) {
    logger?.info?.("Searching NAVCEN window for summary", { windowDays });
    const summaryCandidates = [];
    const maxPages = windowDays <= 7 ? 1 : 2;

    for (let page = 0; page < maxPages; page += 1) {
      const pageResults = await navcen.fetchSearchResultsPage({
        days: windowDays,
        page,
      });
      logger?.info?.("Scanning search results page for latest summary", {
        windowDays,
        page,
        candidates: pageResults.length,
      });

      for (const candidate of pageResults) {
        const message = await navcen.fetchMessage(candidate.guid);
        if (!isLikelySummaryMessage(message)) {
          continue;
        }

        const parsedSummary = parseSummaryMessage(message);
        if (parsedSummary.active_notice_ids.length > 0) {
          summaryCandidates.push(parsedSummary);
          logger?.info?.("Found summary candidate", {
            windowDays,
            page,
            guid: parsedSummary.guid,
            published_at: parsedSummary.published_at,
            activeNoticeIds: parsedSummary.active_notice_ids.length,
          });
        }
      }

      if (pageResults.length < 25) {
        break;
      }
    }

    if (summaryCandidates.length > 0) {
      const latestSummary = summaryCandidates.reduce((best, current) => {
        const bestTime = best?.published_at
          ? new Date(best.published_at).getTime()
          : 0;
        const currentTime = current?.published_at
          ? new Date(current.published_at).getTime()
          : 0;
        return currentTime > bestTime ? current : best;
      }, null);

      logger?.info?.("Selected newest summary after bounded window scan", {
        windowDays,
        guid: latestSummary.guid,
        published_at: latestSummary.published_at,
        candidates: summaryCandidates.length,
      });

      return {
        summary: latestSummary,
        summaryWindowDays: windowDays,
      };
    }
  }

  return {
    summary: null,
    summaryWindowDays: null,
  };
}

async function resolveActiveNoticeIds({
  navcen,
  logger,
  activeNoticeIds,
  searchWindowsDays,
  initialIndex = {},
}) {
  let resolutionIndex = limitIndexToNoticeIds(initialIndex, activeNoticeIds);
  const resolutionWindows = uniqueWindows([...searchWindowsDays, 120, 180]);

  for (const windowDays of resolutionWindows) {
    const unresolvedIds = activeNoticeIds.filter(
      (noticeId) => !resolutionIndex[noticeId]
    );

    if (unresolvedIds.length === 0) {
      break;
    }

    logger?.info?.("Resolving active notice IDs from search results", {
      windowDays,
      unresolvedIds,
    });
    const searchResults = await navcen.fetchSearchResults({ days: windowDays });
    const searchResultIndex = buildResolutionIndexFromSearchResults(searchResults);

    unresolvedIds.forEach((noticeId) => {
      if (searchResultIndex[noticeId]) {
        resolutionIndex[noticeId] = searchResultIndex[noticeId];
      }
    });

    logger?.info?.("Resolution status after targeted lookup", {
      windowDays,
      resolved: activeNoticeIds.filter((noticeId) => resolutionIndex[noticeId]).length,
      unresolved: activeNoticeIds.filter((noticeId) => !resolutionIndex[noticeId]),
    });
  }

  return resolutionIndex;
}

export async function runDailyBrief({
  logger,
  storeDir = DEFAULT_STORE_DIR,
  aoi = DEFAULT_AOI,
  searchWindowsDays = DEFAULT_SEARCH_WINDOWS_DAYS,
  client = null,
  channel = null,
  now = new Date(),
  useRunCache = true,
  forceRefresh = false,
} = {}) {
  const dateKey = dateKeyForPacific(now);
  logger?.info?.("Starting BNM daily brief run", {
    storeDir,
    searchWindowsDays,
    now: now.toISOString(),
    dateKey,
    useRunCache,
    forceRefresh,
  });
  const store = new StoreManager(storeDir);
  await store.ensureLayout();

  if (useRunCache && !forceRefresh) {
    const cachedRun = await store.loadRunOutput(dateKey);
    if (cachedRun?.summary && cachedRun?.slack_text) {
      logger?.info?.("Using cached BNM run artifact", {
        dateKey,
        runPath: store.runPath(dateKey),
        ran_at: cachedRun.ran_at ?? null,
      });
      return {
        summary: cachedRun.summary,
        notices: cachedRun.notices ?? [],
        filtered: cachedRun.filtered,
        slackText: cachedRun.slack_text,
        mapPath: cachedRun.map_path ?? null,
        runPath: store.runPath(dateKey),
      };
    }
  }

  const navcen = new NavcenClient({ logger });

  const storedIndex = await store.loadIdIndex();
  const { summary: latestSummary } = await findLatestSummary({
    navcen,
    logger,
    searchWindowsDays,
  });

  if (!latestSummary) {
    throw new Error("Unable to locate latest Sector San Diego summary message");
  }

  logger?.info?.("Found latest summary", {
    guid: latestSummary.guid,
    published_at: latestSummary.published_at,
    active_notice_ids: latestSummary.active_notice_ids.length,
  });
  if (!latestSummary.is_full_state_snapshot) {
    logger?.warn?.(
      "Latest summary is not a full-state snapshot; historical summary backfill is not implemented yet"
    );
  }

  const activeNoticeIds = latestSummary.active_notice_ids;
  const resolutionIndex = await resolveActiveNoticeIds({
    navcen,
    logger,
    activeNoticeIds,
    searchWindowsDays,
    initialIndex: storedIndex,
  });

  await store.saveLatestSummary(latestSummary);
  await store.saveIdIndex(resolutionIndex);
  logger?.info?.("Saved summary and resolution index", {
    summaryGuid: latestSummary.guid,
    activeNoticeIds: activeNoticeIds.length,
    indexedNoticeIds: Object.keys(resolutionIndex).length,
  });
  const notices = [];

  for (const noticeId of activeNoticeIds) {
    logger?.info?.("Processing active notice", { noticeId });
    const resolved = resolutionIndex[noticeId];
    if (!resolved?.guid) {
      logger?.warn?.("Unable to resolve active notice", { noticeId });
      notices.push({
        notice_id: noticeId,
        category: null,
        raw_body: "",
        parse_warnings: ["resolution_missing"],
      });
      continue;
    }

    const cached = await store.loadNotice(noticeId);
    const reparsedFromCache =
      cached?.raw_body && cached?.guid === resolved.guid
        ? normalizeParsedNotice(
            parseNoticeMessage({
              text: cached.raw_body,
              guid: cached.guid,
              url: cached.url,
            }),
            noticeId
          )
        : null;

    if (isParsedNoticeUsable(reparsedFromCache, noticeId, resolved.guid)) {
      await store.saveNotice(noticeId, reparsedFromCache);
      logger?.info?.("Using cached parsed notice", {
        noticeId,
        guid: resolved.guid,
      });
      notices.push(reparsedFromCache);
      continue;
    }

    logger?.info?.("Fetching full notice", {
      noticeId,
      guid: resolved.guid,
    });
    const message = await navcen.fetchMessage(resolved.guid);
    const parsedNotice = normalizeParsedNotice(parseNoticeMessage(message), noticeId);
    await store.saveNotice(noticeId, parsedNotice);
    logger?.info?.("Parsed and cached full notice", {
      noticeId,
      guid: resolved.guid,
      warnings: parsedNotice.parse_warnings,
      hasGeometry: Boolean(parsedNotice.geometry),
    });
    notices.push(parsedNotice);
  }

  const filtered = filterNotices(notices, { aoi });
  logger?.info?.("Computed notice relevance buckets", {
    high_priority: filtered.high_priority.length,
    background: filtered.background.length,
    out_of_area: filtered.out_of_area.length,
    unparsed: filtered.unparsed.length,
  });
  const mapPath = store.mapPath(dateKey);
  const svgPath = store.mapSvgPath(dateKey);
  const mappedNotices = [...filtered.high_priority, ...filtered.background].filter(
    (notice) => notice.geometry?.coordinates?.[0]?.length
  );
  const generatedMapPath =
    mappedNotices.length > 0
      ? await generateMapImage({
          notices: mappedNotices,
          aoi,
          svgPath,
          pngPath: mapPath,
        })
      : null;
  logger?.info?.("Map generation complete", {
    mappedNotices: mappedNotices.length,
    mapPath: generatedMapPath,
  });

  const slackText = buildSlackBrief({
    filtered,
    summary: latestSummary,
    mapPath: generatedMapPath ? path.relative(process.cwd(), generatedMapPath) : null,
    now,
  });

  const runPayload = {
    ran_at: now.toISOString(),
    summary: latestSummary,
    notices,
    filtered,
    map_path: generatedMapPath,
    slack_text: slackText,
  };

  await store.saveRunOutput(dateKey, runPayload);
  logger?.info?.("Saved BNM run artifact", {
    runPath: store.runPath(dateKey),
  });

  if (client && channel) {
    if (mappedNotices.length > 0) {
      await client.files.uploadV2({
        channel_id: channel,
        initial_comment: "Daily NOTMAR map",
        file: generatedMapPath,
        filename: path.basename(generatedMapPath),
      });
    } else {
      await client.chat.postMessage({
        channel,
        text: slackText,
      });
    }
  }

  return {
    summary: latestSummary,
    notices,
    filtered,
    slackText,
    mapPath: generatedMapPath,
    runPath: store.runPath(dateKey),
  };
}
