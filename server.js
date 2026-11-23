const express = require("express");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";

const WORKER_ENDPOINT = "https://loreal-beauty-advisor.mo10saidmm.workers.dev/project9";
const WORKER_ORIGIN = "https://mohamedbadr-22.github.io";
const REQUEST_TIMEOUT_MS = 40_000;

const jsonParser = express.json({ limit: "200kb" });

// Proxy routine and follow-up requests to the live Cloudflare Worker
app.post(
  "/api/routine",
  (req, res, next) => {
    jsonParser(req, res, (err) => {
      if (err) {
        const status = err.type === "entity.too.large" ? 413 : 400;
        return res.status(status).json({ error: "Invalid or oversized JSON payload." });
      }
      next();
    });
  },
  async (req, res) => {
    const body = req.body;
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !Array.isArray(body.products) ||
      !Array.isArray(body.messages) ||
      body.messages.length === 0
    ) {
      return res.status(400).json({ error: "Request must include products and messages." });
    }

    const payload = {
      products: body.products,
      messages: body.messages,
      mode: body.mode === "routine" ? "routine" : "follow-up",
      webSearch: Boolean(body.webSearch),
      rtl: Boolean(body.rtl)
    };

    try {
      const upstream = await fetch(WORKER_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Origin": WORKER_ORIGIN
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });

      const rawText = await upstream.text();
      let data;
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        return res.status(upstream.status >= 400 ? upstream.status : 502).json({
          error: "The routine advisor returned an invalid JSON response."
        });
      }

      return res.status(upstream.status).json(data);
    } catch (error) {
      if (error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        return res.status(504).json({ error: "The routine advisor timed out. Try again." });
      }
      return res.status(502).json({ error: "Could not reach the routine advisor. Try again." });
    }
  }
);

// Serve static assets from the project root
app.use(express.static(path.join(__dirname)));

// Serve index.html for the root route and any unmatched GET requests
app.use((req, res, next) => {
  if (req.method === "GET") {
    return res.sendFile(path.join(__dirname, "index.html"));
  }
  next();
});

app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
