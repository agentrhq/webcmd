const { spawn } = require("child_process");

const WEBCMD_CLI_PATH = process.env.WEBCMD_CLI_PATH || "webcmd";
const WEBCMD_TIMEOUT = Number(process.env.WEBCMD_TIMEOUT || 60000);

function runCommand(args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(WEBCMD_CLI_PATH, args, {
      shell: true,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Webcmd command timed out"));
    }, WEBCMD_TIMEOUT);

    child.on("close", (code) => {
      clearTimeout(timer);

      if (code !== 0) {
        reject(
          new Error(`Webcmd failed (${code}): ${stderr || stdout}`)
        );
        return;
      }

      resolve(stdout);
    });

    if (input) {
      child.stdin.write(input);
    }

    child.stdin.end();
  });
}

function parseWebcmdOutput(raw) {
  const text = String(raw || "").trim();

  try {
    return JSON.parse(text);
  } catch (_) {}

  const startObject = text.indexOf("{");
  const endObject = text.lastIndexOf("}");

  if (startObject !== -1 && endObject > startObject) {
    try {
      return JSON.parse(
        text.slice(startObject, endObject + 1)
      );
    } catch (_) {}
  }

  return null;
}

async function createSession() {
  const output = await runCommand([
    "session",
    "create",
    "application-rescue",
    "-f",
    "json",
  ]);

  const parsed = parseWebcmdOutput(output);

  const sessionId =
    parsed?.id ||
    parsed?.session?.id ||
    parsed?.result?.id;

  if (!sessionId) {
    throw new Error(
      `Could not get Webcmd session ID: ${output}`
    );
  }

  console.log(`[discovery] Created Webcmd session: ${sessionId}`);

  return sessionId;
}

async function closeSession(sessionId) {
  try {
    await runCommand([
      "session",
      "close",
      sessionId,
    ]);

    console.log(`[discovery] Closed session: ${sessionId}`);
  } catch (_) {
    // Ignore close errors
  }
}

async function runBrowser(sessionId, script) {
  const output = await runCommand(
    [
      "--session",
      sessionId,
      "browser",
      "run",
      "--stdin",
    ],
    script
  );

  const parsed = parseWebcmdOutput(output);

  if (!parsed || parsed.ok === false) {
    throw new Error(
      `Browser command failed: ${output}`
    );
  }

  return parsed.result;
}

/* ---------------------------------------------------------
   SEARCH QUERIES
--------------------------------------------------------- */

function buildSearchQueries(profile = {}) {
  const skills = Array.isArray(profile.skills)
    ? profile.skills.join(" ")
    : "";

  const interests = Array.isArray(profile.interests)
    ? profile.interests.join(" ")
    : "";

  const degree =
    profile.degree || "computer science";

  const year =
    profile.year || "student";

  return [
    `${degree} internships 2026 ${skills}`,
    `computer science scholarships 2026 ${year}`,
    `student fellowships 2026 technology ${interests}`,
    `student competitions hackathons 2026 ${skills}`,
    `grants student programs 2026 technology`,
  ];
}

/* ---------------------------------------------------------
   URL HANDLING
--------------------------------------------------------- */

function extractRealUrl(url) {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);

    // DuckDuckGo redirect URL
    if (
      parsed.hostname.includes("duckduckgo.com") &&
      parsed.searchParams.has("uddg")
    ) {
      const target =
        parsed.searchParams.get("uddg");

      return target
        ? decodeURIComponent(target)
        : null;
    }

    return url;
  } catch (_) {
    return null;
  }
}

/* ---------------------------------------------------------
   CLASSIFICATION
--------------------------------------------------------- */

function classifyOpportunity(title, url) {
  const text =
    `${title} ${url}`.toLowerCase();

  if (
    text.includes("scholarship") ||
    text.includes("scholarships")
  ) {
    return "Scholarship";
  }

  if (
    text.includes("fellowship") ||
    text.includes("fellowships")
  ) {
    return "Fellowship";
  }

  if (
    text.includes("hackathon") ||
    text.includes("competition") ||
    text.includes("contest")
  ) {
    return "Competition";
  }

  if (
    text.includes("grant") ||
    text.includes("grants")
  ) {
    return "Grant";
  }

  if (
    text.includes("university program") ||
    text.includes("student program")
  ) {
    return "University Program";
  }

  return "Internship";
}

function isUsefulOpportunity(title, url) {
  const text =
    `${title} ${url}`.toLowerCase();

  const positiveKeywords = [
    "intern",
    "internship",
    "scholarship",
    "fellowship",
    "hackathon",
    "competition",
    "contest",
    "grant",
    "student program",
    "university program",
    "opportunity",
  ];

  const negativeKeywords = [
    "coursera article",
    "blog",
    "guide",
    "salary",
    "course",
    "tutorial",
  ];

  const hasPositive =
    positiveKeywords.some((word) =>
      text.includes(word)
    );

  const hasNegative =
    negativeKeywords.some((word) =>
      text.includes(word)
    );

  return hasPositive && !hasNegative;
}

/* ---------------------------------------------------------
   ORGANIZATION
--------------------------------------------------------- */

function getOrganization(url) {
  try {
    const hostname =
      new URL(url).hostname.replace(
        /^www\./,
        ""
      );

    const parts = hostname.split(".");

    if (parts.length >= 2) {
      return parts[parts.length - 2]
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (c) =>
          c.toUpperCase()
        );
    }

    return hostname;
  } catch (_) {
    return "Unknown Organization";
  }
}

/* ---------------------------------------------------------
   SEARCH WEB
--------------------------------------------------------- */

async function searchWeb(sessionId, query) {
  console.log(
    `[discovery] Searching: ${query}`
  );

  const script = `
    const query = ${JSON.stringify(query)};

    const searchUrl =
      "https://html.duckduckgo.com/html/?q=" +
      encodeURIComponent(query) +
      "&kl=in-en";

    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded"
    });

    await page.waitForTimeout(1500);

    const links = await page.locator("a").evaluateAll(
      links =>
        links.map(a => ({
          title: (a.innerText || "").trim(),
          url: a.href
        }))
    );

    return JSON.stringify({
      query,
      results: links
    });
  `;

  const result =
    await runBrowser(sessionId, script);

  let data = result;

  if (typeof result === "string") {
    try {
      data = JSON.parse(result);
    } catch (_) {}
  }

  const results =
    Array.isArray(data?.results)
      ? data.results
      : [];

  console.log(
    `[discovery] Found ${results.length} raw results`
  );

  return results;
}

/* ---------------------------------------------------------
   LIVE DEADLINE EXTRACTION
--------------------------------------------------------- */

function parseDateString(value) {
  if (!value) {
    return null;
  }

  const cleaned =
    String(value)
      .replace(/\s+/g, " ")
      .trim();

  // Examples:
  // 30 September 2026
  // September 30, 2026
  // 30/09/2026
  // 30-09-2026
  // 2026-09-30

  const patterns = [
    /\b\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/i,

    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/i,

    /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}\b/,

    /\b\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\b/,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);

    if (match) {
      const date = new Date(match[0]);

      if (
        !Number.isNaN(date.getTime()) &&
        date.getFullYear() >= 2025
      ) {
        return date;
      }
    }
  }

  return null;
}

async function extractLiveDetails(
  sessionId,
  url
) {
  console.log(
    `[discovery] Opening opportunity page: ${url}`
  );

  try {
    const script = `
      const targetUrl = ${JSON.stringify(url)};

      await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000
      });

      await page.waitForTimeout(2000);

      const title =
        await page.title().catch(() => "");

      const bodyText =
        await page.locator("body").innerText()
          .catch(() => "");

      const metaDescription =
        await page.locator(
          'meta[name="description"]'
        ).getAttribute("content")
          .catch(() => "");

      const h1 =
        await page.locator("h1").first()
          .innerText()
          .catch(() => "");

      return JSON.stringify({
        title,
        h1,
        bodyText: bodyText.slice(0, 30000),
        metaDescription
      });
    `;

    const result =
      await runBrowser(sessionId, script);

    let data = result;

    if (typeof result === "string") {
      try {
        data = JSON.parse(result);
      } catch (_) {}
    }

    const bodyText =
      String(data?.bodyText || "");
      

    const combinedText =
      `${data?.title || ""}
       ${data?.h1 || ""}
       ${bodyText}`;

    const deadline =
      extractDeadlineFromText(combinedText);

    return {
      title:
        data?.h1 ||
        data?.title ||
        null,

      description:
        data?.metaDescription ||
        "",

      deadline,
    };
  } catch (error) {
    console.error(
      `[discovery] Could not open ${url}:`,
      error.message
    );

    return {
      title: null,
      description: "",
      deadline: null,
    };
  }
}

/* ---------------------------------------------------------
   DEADLINE TEXT DETECTION
--------------------------------------------------------- */

function extractDeadlineFromText(text) {
  if (!text) {
    return null;
  }

  const normalized = String(text)
    .replace(/\s+/g, " ")
    .trim();

  /*
   * We first look around deadline-related words.
   */
  const deadlineKeywords = [
    "application deadline",
    "applications deadline",
    "deadline",
    "apply by",
    "last date to apply",
    "last day to apply",
    "application closes",
    "applications close",
    "closing date",
    "submission deadline",
    "deadline to apply",
  ];

  const lowerText = normalized.toLowerCase();

  for (const keyword of deadlineKeywords) {
    let start = 0;

    while (true) {
      const index = lowerText.indexOf(
        keyword,
        start
      );

      if (index === -1) {
        break;
      }

      /*
       * Look at roughly 250 characters after
       * the deadline label.
       */
      const section = normalized.slice(
        index,
        index + 300
      );

      const date = findDateInText(section);

      if (date) {
        return date;
      }

      start = index + keyword.length;
    }
  }

  /*
   * Some websites don't explicitly put the word
   * "deadline" immediately before the date.
   *
   * So check common date formats in the page.
   */
  return findDateInText(normalized);
}
function findDateInText(text) {
  if (!text) {
    return null;
  }

  const datePatterns = [
    /*
     * 30 September 2026
     */
    /\b(0?[1-9]|[12]\d|3[01])\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(202[5-9])\b/gi,

    /*
     * September 30, 2026
     */
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(0?[1-9]|[12]\d|3[01]),?\s+(202[5-9])\b/gi,

    /*
     * 30/09/2026
     */
    /\b(0?[1-9]|[12]\d|3[01])[\/\-](0?[1-9]|1[0-2])[\/\-](202[5-9])\b/g,

    /*
     * 2026-09-30
     */
    /\b(202[5-9])[\/\-](0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])\b/g,

    /*
     * 30.09.2026
     */
    /\b(0?[1-9]|[12]\d|3[01])\.(0?[1-9]|1[0-2])\.(202[5-9])\b/g,
  ];

  for (const pattern of datePatterns) {
    const match = pattern.exec(text);

    if (!match) {
      continue;
    }

    const dateText = match[0];

    const parsed = parseFlexibleDate(
      dateText
    );

    if (parsed) {
      return parsed;
    }
  }

  return null;
}
function parseFlexibleDate(value) {
  if (!value) {
    return null;
  }

  const cleaned = value.trim();

  /*
   * YYYY-MM-DD
   */
  let match = cleaned.match(
    /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/
  );

  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    return createValidDate(
      year,
      month,
      day
    );
  }

  /*
   * DD/MM/YYYY or DD-MM-YYYY
   */
  match = cleaned.match(
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/
  );

  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);

    return createValidDate(
      year,
      month,
      day
    );
  }

  /*
   * DD.MM.YYYY
   */
  match = cleaned.match(
    /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/
  );

  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);

    return createValidDate(
      year,
      month,
      day
    );
  }

  /*
   * "30 September 2026"
   */
  match = cleaned.match(
    /^(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})$/i
  );

  if (match) {
    const day = Number(match[1]);
    const month = monthNumber(match[2]);
    const year = Number(match[3]);

    return createValidDate(
      year,
      month,
      day
    );
  }

  /*
   * "September 30, 2026"
   */
  match = cleaned.match(
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})$/i
  );

  if (match) {
    const month = monthNumber(match[1]);
    const day = Number(match[2]);
    const year = Number(match[3]);

    return createValidDate(
      year,
      month,
      day
    );
  }

  return null;
}

function monthNumber(month) {
  const months = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
  };

  return months[
    String(month).toLowerCase()
  ];
}

function createValidDate(
  year,
  month,
  day
) {
  if (
    !year ||
    !month ||
    !day ||
    year < 2025 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const date = new Date(
    year,
    month - 1,
    day
  );

  /*
   * Prevent invalid dates such as
   * 31/02/2026.
   */
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

/* ---------------------------------------------------------
   NORMALIZE SEARCH RESULT
--------------------------------------------------------- */

function normalizeResult(result, query) {
  const title =
    String(result.title || "").trim();

  const realUrl =
    extractRealUrl(result.url);

  if (!title || !realUrl) {
    return null;
  }

  if (!/^https?:\/\//i.test(realUrl)) {
    return null;
  }

  if (!isUsefulOpportunity(title, realUrl)) {
    return null;
  }

  return {
    title,

    organization:
      getOrganization(realUrl),

    type:
      classifyOpportunity(
        title,
        realUrl
      ),

    description:
      `Live opportunity discovered from web search for "${query}".`,

    deadline: null,

    eligibility:
      "Check official opportunity page",

    minCgpa: null,

    requiredSkills: [],

    relatedInterests: [],

    location:
      "See official opportunity page",

    stipendOrAmount: null,

    applyUrl: realUrl,

    sourceUrl: realUrl,

    sourceType: "live",

    discoveredAt: new Date(),

    requiredDocuments: [],
  };
}

/* ---------------------------------------------------------
   DEDUPLICATION
--------------------------------------------------------- */

function dedupeOpportunities(
  opportunities
) {
  const map = new Map();

  for (const opportunity of opportunities) {
    if (!opportunity?.applyUrl) {
      continue;
    }

    const key =
      opportunity.applyUrl
        .replace(/\/$/, "")
        .toLowerCase();

    if (!map.has(key)) {
      map.set(key, opportunity);
    }
  }

  return [...map.values()];
}

/* ---------------------------------------------------------
   MAIN DISCOVERY
--------------------------------------------------------- */

async function discoverOpportunities(
  profile = {}
) {
  const sessionId =
    await createSession();

  try {
    const queries =
      buildSearchQueries(profile);

    const allOpportunities = [];

    for (const query of queries) {
      try {
        const results =
          await searchWeb(
            sessionId,
            query
          );

        for (const result of results) {
          const opportunity =
            normalizeResult(
              result,
              query
            );

          if (opportunity) {
            allOpportunities.push(
              opportunity
            );
          }
        }
      } catch (error) {
        console.error(
          `[discovery] Query failed: ${query}`,
          error.message
        );
      }
    }

    let unique =
      dedupeOpportunities(
        allOpportunities
      );

    console.log(
      `[discovery] Unique opportunities before live extraction: ${unique.length}`
    );

    /*
      Open the actual opportunity pages.

      Limit to 15 pages so one discovery request
      does not take excessively long.
    */

    const opportunitiesToInspect =
      unique.slice(0, 15);

    const enriched = [];

    for (
      const opportunity of opportunitiesToInspect
    ) {
      try {
        const liveDetails =
          await extractLiveDetails(
            sessionId,
            opportunity.sourceUrl
          );

        if (liveDetails.title) {
          opportunity.title =
            liveDetails.title;
        }

        if (liveDetails.description) {
          opportunity.description =
            liveDetails.description;
        }

        /*
          IMPORTANT:
          Only use a deadline that was actually
          found on the opportunity page.
        */

if (liveDetails.deadline) {
  opportunity.deadline = liveDetails.deadline;
} else {
  opportunity.deadline = null;
}

// Do not show expired opportunities
if (opportunity.deadline) {
  const deadline = new Date(opportunity.deadline);

  if (!isNaN(deadline.getTime()) && deadline < new Date()) {
    console.log(
      `[discovery] Skipping expired opportunity: ${opportunity.title}`
    );
    continue;
  }
}

enriched.push(opportunity);

        console.log(
          `[discovery] ${opportunity.title} | Deadline: ${
            opportunity.deadline
              ? opportunity.deadline.toISOString()
              : "Not specified"
          }`
        );
      } catch (error) {
        console.error(
          `[discovery] Detail extraction failed:`,
          error.message
        );

        enriched.push(opportunity);
      }
    }

    unique = enriched;

    console.log(
      `[discovery] Final live opportunities: ${unique.length}`
    );

    return unique.slice(0, 30);
  } finally {
    await closeSession(sessionId);
  }
}

module.exports = {
  discoverOpportunities,
};