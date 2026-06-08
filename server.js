const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

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

      // Resolve relative URLs
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
      } catch (_) {
        // skip malformed
      }
    });

    // Sort: internal first, then external
    links.sort((a, b) => (b.internal ? 1 : 0) - (a.internal ? 1 : 0));

    res.json({
      source: url,
      total: links.length,
      internal: links.filter((l) => l.internal).length,
      external: links.filter((l) => !l.internal).length,
      links,
    });
  } catch (err) {
    const msg =
      err.response
        ? `Server responded with ${err.response.status}`
        : err.code === "ECONNABORTED"
        ? "Request timed out"
        : err.message || "Failed to fetch URL";

    res.status(500).json({ error: msg });
  }
});

app.listen(PORT, () => {
  console.log(`Link Extractor running on http://localhost:${PORT}`);
});
