const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const pdfParse = require("pdf-parse");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

function dedupeEmails(emails) {
  return [...new Set(emails.map((e) => e.toLowerCase().trim()))];
}

function isPdfUrl(url, contentType = "") {
  return (
    url.toLowerCase().includes(".pdf") ||
    contentType.includes("application/pdf")
  );
}

async function fetchPdfEmails(url) {
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 30000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    const data = await pdfParse(Buffer.from(response.data));
    const emails = data.text.match(EMAIL_REGEX) || [];
    return { emails: dedupeEmails(emails), source: "pdf", pages: data.numpages };
  } catch (err) {
    console.error(`Error fetching PDF ${url}:`, err.message);
    return { emails: [], source: "pdf", error: err.message };
  }
}

async function fetchHtmlEmails(url) {
  try {
    const response = await axios.get(url, {
      timeout: 20000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    const html = response.data;
    const $ = cheerio.load(html);
    const rawEmails = html.match(EMAIL_REGEX) || [];
    const mailtoEmails = [];
    $("a[href^='mailto:']").each((_, el) => {
      const href = $(el).attr("href") || "";
      const email = href.replace("mailto:", "").split("?")[0].trim();
      if (email) mailtoEmails.push(email);
    });
    const all = [...rawEmails, ...mailtoEmails];
    return { emails: dedupeEmails(all), source: "html" };
  } catch (err) {
    console.error(`Error fetching HTML ${url}:`, err.message);
    return { emails: [], source: "html", error: err.message };
  }
}

async function extractFromUrl(url) {
  let contentType = "";
  try {
    const head = await axios.head(url, {
      timeout: 10000,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });
    contentType = head.headers["content-type"] || "";
  } catch (_) {}

  if (isPdfUrl(url, contentType)) {
    return await fetchPdfEmails(url);
  } else {
    return await fetchHtmlEmails(url);
  }
}

app.post("/extract", async (req, res) => {
  let { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL is required." });
  }

  // Auto-add https:// if missing
  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url;
  }

  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    const $ = cheerio.load(response.data);
    const baseUrl = new URL(url);
    const links = [];
    const seen = new Set();

    $("a[href]").each((_, el) => {
      let href = $(el).attr("href")?.trim();
      const text = $(el).text().trim().replace(/\s+/g, " ") || "(no text)";

      if (!href || href === "#" || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) return;

      try {
        const resolved = new URL(href, baseUrl).href;
        if (!seen.has(resolved)) {
          seen.add(resolved);
          links.push({
            url: resolved,
            text,
            internal: new URL(resolved).hostname === baseUrl.hostname,
          });
        }
      } catch (_) {}
    });

    links.sort((a, b) => (b.internal ? 1 : 0) - (a.internal ? 1 : 0));

    res.json({
      source: url,
      total: links.length,
      internal: links.filter((l) => l.internal).length,
      external: links.filter((l) => !l.internal).length,
      links,
    });
  } catch (err) {
    // If target site returns 404, we treat it as "no links" rather than a server error
    if (err.response && err.response.status === 404) {
      return res.json({
        source: url,
        total: 0,
        internal: 0,
        external: 0,
        links: [],
        message: "Target URL returned 404"
      });
    }

    const msg =
      err.response
        ? `Server responded with ${err.response.status}`
        : err.code === "ECONNABORTED"
        ? "Request timed out"
        : err.message || "Failed to fetch URL";

    res.status(500).json({ error: msg });
  }
});

app.post("/extract-emails-batch", async (req, res) => {
  const { urls } = req.body;
  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ success: false, error: "urls array is required" });
  }

  const results = await Promise.allSettled(
    urls.map(async (url) => {
      try {
        new URL(url);
        const result = await extractFromUrl(url);
        return {
          success: true,
          url,
          source: result.source,
          count: result.emails.length,
          emails: result.emails,
          ...(result.pages && { pages: result.pages }),
        };
      } catch (err) {
        return { success: false, url, error: err.message, emails: [] };
      }
    })
  );

  const processed = results.map((r) =>
    r.status === "fulfilled" ? r.value : { success: false, error: r.reason?.message }
  );

  const allEmails = [
    ...new Set(processed.flatMap((r) => r.emails || []).map((e) => e.toLowerCase())),
  ];

  return res.json({
    success: true,
    total_urls: urls.length,
    total_emails: allEmails.length,
    results: processed,
    all_emails: allEmails,
  });
});

app.listen(PORT, () => {
  console.log(`Unified Extractor running on port ${PORT}`);
});
