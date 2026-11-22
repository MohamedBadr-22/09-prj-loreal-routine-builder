const byId = (id) => document.getElementById(id);
const categoryFilter = byId("categoryFilter");
const productsContainer = byId("productsContainer");
const chatWindow = byId("chatWindow");
const chatInput = byId("chatInput");
const endpoint = document.querySelector('meta[name="routine-endpoint"]').content;
const selectionKey = "loreal.selectedProducts";
let products = [];
let selected = new Set();
let history = [];
let routineProducts = [];
let busy = false;

function element(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function readSavedSelection() {
  try {
    const saved = JSON.parse(localStorage.getItem(selectionKey));
    return new Set(Array.isArray(saved) ? saved.map(String) : []);
  } catch {
    return new Set();
  }
}

function selectionChanged() {
  try {
    localStorage.setItem(selectionKey, JSON.stringify([...selected]));
  } catch {
    // Selection remains usable during this visit.
  }
  renderSelection();
  for (const card of productsContainer.querySelectorAll("[data-product-id]")) {
    updateCard(card);
  }
}

function updateCard(button) {
  const active = selected.has(button.dataset.productId);
  button.setAttribute("aria-pressed", String(active));
  button.querySelector("[data-selection]").textContent = active ? "✓ Selected" : "Select";
}

function normalize(value) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function displayProducts() {
  const terms = normalize(byId("productSearch").value).trim().split(/\s+/);
  const category = categoryFilter.value;
  const matches = products.filter((product) => {
    const keywords = normalize([product.name, product.brand, product.category, product.description].join(" "));
    return (!category || product.category === category) && terms.every((term) => keywords.includes(term));
  });
  productsContainer.replaceChildren();
  byId("catalogStatus").textContent = matches.length === 0 ? "No matching products." : `${matches.length} products`;
  for (const product of matches) {
    const id = String(product.id);
    const card = element("article");
    card.className = "product-card";
    const button = element("button");
    button.type = "button";
    button.dataset.productId = id;
    const image = element("img");
    image.src = product.image;
    image.alt = "";
    image.loading = "lazy";
    const name = element("strong", product.name);
    name.dir = "auto";
    const brand = element("span", product.brand);
    brand.dir = "auto";
    const marker = element("small");
    marker.dataset.selection = "";
    button.append(image, name, brand, marker);
    updateCard(button);
    button.addEventListener("click", () => {
      if (!selected.delete(id)) selected.add(id);
      selectionChanged();
    });
    const details = element("details");
    const description = element("p", product.description);
    description.dir = "auto";
    details.append(element("summary", "Product details"), description);
    card.append(button, details);
    productsContainer.append(card);
  }
}

function renderSelection() {
  const list = byId("selectedProducts");
  list.replaceChildren();
  for (const product of products.filter(({ id }) => selected.has(String(id)))) {
    const item = element("li");
    const name = element("bdi", product.name);
    const remove = element("button", "Remove");
    remove.setAttribute("aria-label", `Remove ${product.name}`);
    remove.addEventListener("click", () => {
      selected.delete(String(product.id));
      selectionChanged();
      (list.querySelector("button") || byId("productSearch")).focus();
    });
    item.append(name, remove);
    list.append(item);
  }
  byId("selectionStatus").textContent = selected.size ? `${selected.size} selected` : "No products selected yet.";
  updateControls();
}

function updateControls() {
  byId("generateRoutine").disabled = busy || !selected.size;
  byId("clearSelection").disabled = !selected.size;
  byId("send").disabled = chatInput.disabled = busy || !history.length;
}

function addMessage(role, text, sources = []) {
  const article = element("article");
  const message = element("p", text);
  message.className = "message";
  message.dir = "auto";
  article.append(element("strong", role), message);
  if (sources.length) {
    const links = element("ul");
    for (const source of sources) {
      if (!/^https:\/\//i.test(source.url)) continue;
      const item = element("li");
      const link = element("a", source.title);
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      item.append(link);
      links.append(item);
    }
    if (links.childElementCount) article.append(element("strong", "Sources"), links);
  }
  chatWindow.append(article);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

async function requestRoutine(message, selection, generate) {
  busy = true;
  updateControls();
  const status = byId("chatStatus");
  status.textContent = "Waiting for the routine advisor…";
  const messages = [...(generate ? [] : history), { role: "user", text: message }];
  try {
    if (!endpoint) throw new Error("The Cloudflare Worker URL has not been configured.");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        products: selection, messages, mode: generate ? "routine" : "follow-up",
        webSearch: byId("webSearch").checked, rtl: byId("rtl").checked
      }),
      signal: AbortSignal.timeout(45000)
    });
    const data = await response.json();
    if (!response.ok || !data.reply) throw new Error(data.error || "The advisor could not respond. Try again.");
    history = [...messages, { role: "model", text: data.reply }];
    routineProducts = selection;
    if (generate) chatWindow.replaceChildren();
    addMessage("You", message);
    addMessage("Routine advisor", data.reply, data.sources);
    if (!generate) chatInput.value = "";
    status.textContent = data.searchRequested && !data.sources?.length ? "No web sources were returned." : "";
  } catch (error) {
    status.textContent = error instanceof TypeError || error.name === "TimeoutError"
      ? "Could not reach the routine advisor. Try again." : error.message;
  } finally {
    busy = false;
    updateControls();
    if (!generate) chatInput.focus();
  }
}

categoryFilter.addEventListener("change", displayProducts);
byId("productSearch").addEventListener("input", displayProducts);
byId("rtl").addEventListener("change", (event) => {
  document.documentElement.dir = event.target.checked ? "rtl" : "ltr";
});
byId("clearSelection").addEventListener("click", () => {
  selected.clear();
  selectionChanged();
  byId("productSearch").focus();
});
byId("generateRoutine").addEventListener("click", () => {
  if (busy || !selected.size) return;
  const selection = products.filter(({ id }) => selected.has(String(id)))
    .map(({ name, brand, category, description }) => ({ name, brand, category, description }));
  const message = byId("rtl").checked
    ? "أنشئ روتينًا باستخدام المنتجات التي اخترتها."
    : "Build a routine using the products I selected.";
  requestRoutine(message, selection, true);
});
byId("chatForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (message && history.length && !busy) requestRoutine(message, routineProducts, false);
});

async function loadProducts() {
  try {
    const response = await fetch("products.json");
    if (!response.ok) throw new Error("Catalog unavailable");
    ({ products } = await response.json());
    if (!Array.isArray(products)) throw new Error("Invalid catalog");
    const saved = readSavedSelection();
    selected = new Set(products.map(({ id }) => String(id)).filter((id) => saved.has(id)));
    for (const category of [...new Set(products.map((product) => product.category))].sort()) {
      categoryFilter.append(new Option(category[0].toUpperCase() + category.slice(1), category));
    }
    displayProducts();
    renderSelection();
  } catch {
    byId("catalogStatus").textContent = "Could not load the product catalog. Refresh to try again.";
  }
}
loadProducts();
