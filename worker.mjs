const instructions = `You are a L’Oréal beauty routine advisor. Discuss only the
user’s routine or skincare, haircare, makeup, fragrance, and related beauty
topics. Politely redirect unrelated questions. For a new routine, use only the
selected catalog products. Organize them into a practical order and explain
when to use each. Flag redundant steps and possible irritation. Do not invent
ingredients, instructions, claims, or source links. For follow-ups, use the
conversation history. Reply in the user’s language. Keep answers concise.`;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const allowed = env.ALLOWED_ORIGIN;
    const headers = {
      "Access-Control-Allow-Origin": allowed || "null",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store",
      Vary: "Origin"
    };
    const json = (body, status = 200) => Response.json(body, { status, headers });
    if (!allowed || origin !== allowed) return json({ error: "Origin not allowed." }, 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return json({ error: "Use POST." }, 405);
    if (!env.GEMINI_API_KEY || !env.RATE_LIMITER) {
      return json({ error: "The routine advisor is not configured." }, 503);
    }
    const { success } = await env.RATE_LIMITER.limit({
      key: request.headers.get("CF-Connecting-IP") || "unknown"
    });
    if (!success) return json({ error: "Too many requests. Try again in a minute." }, 429);

    let body;
    try {
      const raw = await request.text();
      if (raw.length > 120000) return json({ error: "This conversation is too long. Start a new routine." }, 413);
      body = JSON.parse(raw);
    } catch {
      return json({ error: "Invalid request." }, 400);
    }
    const { products, messages, mode, webSearch } = body || {};
    const fields = ["name", "brand", "category", "description"];
    const validProducts = Array.isArray(products) && products.length > 0 && products.length <= 35
      && products.every((product) => product && fields.every((field) =>
        typeof product[field] === "string" && product[field].length > 0 && product[field].length <= 1200));
    const validMessages = Array.isArray(messages) && messages.length % 2 === 1
      && messages.every((message, index) => message && message.role === (index % 2 ? "model" : "user")
        && typeof message.text === "string" && !!message.text.trim()
        && message.text.length <= (index % 2 ? 12000 : 1500));
    if (!validProducts || !validMessages || !["routine", "follow-up"].includes(mode)
      || (mode === "routine" && messages.length !== 1)) {
      return json({ error: "Select products and provide a valid message." }, 400);
    }
    const catalog = products.map((product) => Object.fromEntries(fields.map((field) => [field, product[field]])));
    const contents = messages.map(({ role, text }, index) => ({
      role,
      parts: [{ text: index ? text : `Selected product data: ${JSON.stringify(catalog)}\nRequest: ${text}` }]
    }));
    const payload = {
      systemInstruction: { parts: [{ text: instructions }] },
      contents,
      generationConfig: { maxOutputTokens: 1800 }
    };
    if (webSearch === true) payload.tools = [{ google_search: {} }];
    const model = encodeURIComponent(env.GEMINI_MODEL || "gemini-2.5-flash");
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(35000)
      });
      if (response.status === 429) return json({ error: "Google AI quota is temporarily unavailable." }, 429);
      if (!response.ok) return json({ error: "Google AI could not process the request." }, 502);
      const data = await response.json();
      const candidate = data.candidates?.[0];
      const reply = candidate?.content?.parts?.filter((part) => !part.thought)
        .map((part) => part.text || "").join("").trim();
      if (!reply) return json({ error: "The advisor returned no answer. Try rephrasing your question." }, 502);
      const sources = [];
      const seen = new Set();
      for (const { web } of candidate.groundingMetadata?.groundingChunks || []) {
        if (!web?.uri || !/^https:\/\//i.test(web.uri) || seen.has(web.uri)) continue;
        seen.add(web.uri);
        sources.push({ url: web.uri, title: web.title || new URL(web.uri).hostname });
      }
      return json({ reply, sources, searchRequested: webSearch === true });
    } catch {
      return json({ error: "Google AI is temporarily unavailable." }, 502);
    }
  }
};
