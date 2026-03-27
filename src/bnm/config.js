import path from "node:path";

export const PACIFIC_TIME_ZONE = "America/Los_Angeles";
export const NAVCEN_BASE_URL = "https://www.navcen.uscg.gov";
export const NAVCEN_SEARCH_PATH =
  "/broadcast-notice-to-mariners-search-results";
export const NAVCEN_MESSAGE_PATH = "/broadcast-notice-to-mariners-message";
export const NAVCEN_RSS_URL =
  "https://www.navcen.uscg.gov/broadcast-notice-to-mariners-rss";

export const DEFAULT_STORE_DIR = path.resolve(process.cwd(), "store");
export const DEFAULT_MAP_SVG_PATH = "maps";
export const DEFAULT_NOTICE_DIR = "notices";
export const DEFAULT_RUN_DIR = "runs";

export const DEFAULT_SEARCH_WINDOWS_DAYS = [30, 60];
export const NAVCEN_DISTRICT = "11";
export const NAVCEN_SAN_DIEGO_SECTOR = "0 34 35";
export const NAVCEN_PAGE_SIZE = 50;

export const DEFAULT_AOI = {
  name: "Sector San Diego AOI",
  extent: {
    minLon: -119.35,
    maxLon: -117.05,
    minLat: 31.75,
    maxLat: 33.20,
  },
  polygon: [
    [-119.35, 31.75],
    [-117.05, 31.75],
    [-117.05, 33.20],
    [-119.35, 33.20],
    [-119.35, 31.75],
  ],
};

export const DEFAULT_BASEMAP = {
  path: path.resolve(process.cwd(), "public", "map-main.png"),
  extent: {
    minLon: -119.53125,
    maxLon: -116.71875,
    minLat: 31.653381399663985,
    maxLat: 33.7243396617476,
  },
};

export const DEFAULT_MAP_VIEW = {
  extent: {
    minLon: -119.35,
    maxLon: -117.0,
    minLat: 31.85,
    maxLat: 33.2,
  },
};

export const DEFAULT_MISSION_WINDOW = {
  startHour: 9,
  durationHours: 4,
};

export const HIGH_PRIORITY_KEYWORDS = [
  "hazardous operations",
  "haz ops",
  "military operations",
  "navy dive",
  "dive operations",
  "remain clear",
  "avoid area",
  "firing",
  "gunnery",
];

export const LOCAL_RELEVANCE_KEYWORDS = [
  "san diego",
  "point loma",
  "coronado",
  "imperial beach",
  "mission bay",
  "la jolla",
  "north island",
  "silver strand",
];
