// ══════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════
const API_BASE = "https://gifts-bot-9e9.h.jrnm.app";

const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

let currentUser = null;
let animInstances = [];
let previewAnim = null;
let editingGiftId = null;
let fetchedAnimationJson = null; // set when a gift's animation came from Fragment, not a manual upload

function withAuth(url) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}init_data=${encodeURIComponent(tg.initData)}`;
}

// ══════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════
async function authenticate() {
  if (!tg.initData) { showError("Open this app from within Telegram."); return; }

  const res = await fetch(withAuth(`${API_BASE}/api/auth`), { method: "POST" });
  if (res.status === 403) { showError("You are banned from this shop."); return; }
  if (!res.ok) { showError("Login failed. Please reopen the app."); return; }

  currentUser = await res.json();
  document.getElementById("role-badge").textContent = currentUser.role;

  if (currentUser.role === "owner" || currentUser.role === "admin") {
    document.getElementById("nav-gifts").classList.remove("hidden");
    document.getElementById("nav-users").classList.remove("hidden");
  }
  if (currentUser.role !== "owner") {
    document.getElementById("nft-pricing-btn").classList.add("hidden");
  }

  await loadGifts();
  loadLogo();
  document.getElementById("loading").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
}

function loadLogo() {
  const box = document.getElementById("shop-logo");
  try {
    lottie.loadAnimation({
      container: box, renderer: "svg", loop: true, autoplay: true, path: "Logo.json",
    }).addEventListener("data_failed", () => box.remove());
  } catch {
    box.remove();
  }
}

function showError(msg) {
  document.getElementById("loading").classList.add("hidden");
  document.getElementById("error-text").textContent = msg;
  document.getElementById("error").classList.remove("hidden");
}

// ══════════════════════════════════════════════════════════════
// TAB NAVIGATION
// ══════════════════════════════════════════════════════════════
function switchTab(tab) {
  ["shop", "orders", "convert", "gifts", "users"].forEach((t) => {
    document.getElementById(`tab-${t}`).classList.toggle("hidden", t !== tab);
  });
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));

  const titles = { shop: "Gifts Shop", orders: "My Orders", convert: "NFT to Sticker", gifts: "Manage Gifts", users: "Manage Users" };
  document.getElementById("page-title").textContent = titles[tab];

  if (tab === "orders") loadOrders();
  if (tab === "gifts") loadAdminGifts();
  if (tab === "users") loadUsers();
  tg.HapticFeedback?.impactOccurred("light");
}

// ══════════════════════════════════════════════════════════════
// NFT → STICKER CONVERTER (customer-facing)
// ══════════════════════════════════════════════════════════════
let convertAnim = null;
let convertSlug = null;
let convertOrderId = null;

async function previewConvert() {
  const link = document.getElementById("cv-nft-link").value.trim();
  const status = document.getElementById("cv-status");
  const result = document.getElementById("cv-result");
  const btn = document.getElementById("cv-fetch-btn");

  if (!link) { status.style.color = "#ff6b6b"; status.textContent = "Paste an NFT link first."; return; }

  status.style.color = "#8b8b9a";
  status.textContent = "Loading preview…";
  result.classList.add("hidden");
  btn.disabled = true;

  const res = await fetch(withAuth(`${API_BASE}/api/nft/preview`), {
    method: "POST",
    body: JSON.stringify({ nft_link: link }),
  });
  btn.disabled = false;

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    status.style.color = "#ff6b6b";
    status.textContent = e.detail || "Could not load preview.";
    return;
  }

  const data = await res.json();
  if (data.status === "not_ready") {
    status.style.color = "#ffcf5c";
    status.textContent = data.message;
    return;
  }

  status.textContent = "";
  convertSlug = data.slug;
  convertOrderId = null;

  document.getElementById("cv-name").textContent = data.name || data.slug;
  document.getElementById("cv-price").textContent = data.price > 0 ? `${data.price} ⭐` : "Preview only (staff account)";
  document.getElementById("cv-buy-btn").classList.toggle("hidden", data.price <= 0);

  const table = document.getElementById("cv-preview-table");
  table.innerHTML = `
    ${data.model ? `<div class="row"><span class="label">Model</span><span class="value">${escapeHtml(data.model)}</span></div>` : ""}
    ${data.backdrop ? `<div class="row"><span class="label">Backdrop</span><span class="value">${escapeHtml(data.backdrop)}</span></div>` : ""}
    ${data.symbol ? `<div class="row"><span class="label">Symbol</span><span class="value">${escapeHtml(data.symbol)}</span></div>` : ""}
  `;

  const box = document.getElementById("cv-anim");
  box.innerHTML = "";
  if (convertAnim) convertAnim.destroy();
  try {
    const animData = JSON.parse(data.animation_json);
    convertAnim = lottie.loadAnimation({ container: box, renderer: "svg", loop: true, autoplay: true, animationData: animData });
  } catch {}

  result.classList.remove("hidden");
}

async function buyConvert() {
  const status = document.getElementById("cv-status");
  const link = document.getElementById("cv-nft-link").value.trim();
  status.style.color = "#5b8cff";
  status.textContent = "Opening payment…";

  const payRes = await fetch(withAuth(`${API_BASE}/api/nft/convert/pay`), {
    method: "POST",
    body: JSON.stringify({ nft_link: link }),
  });
  if (!payRes.ok) {
    const e = await payRes.json().catch(() => ({}));
    status.style.color = "#ff6b6b";
    status.textContent = e.detail || "Could not start payment.";
    return;
  }
  const payData = await payRes.json();

  tg.openInvoice(payData.invoice_link, (paymentStatus) => {
    if (paymentStatus === "paid") {
      status.style.color = "#4ade80";
      status.textContent = "✅ Paid! Check your chat with the bot for your sticker.";
      tg.HapticFeedback?.notificationOccurred("success");
    } else if (paymentStatus === "cancelled") {
      status.style.color = "#ff6b6b";
      status.textContent = "Payment cancelled.";
    } else if (paymentStatus === "failed") {
      status.style.color = "#ff6b6b";
      status.textContent = "Payment failed. Try again.";
    }
  });
}

// ══════════════════════════════════════════════════════════════
// OWNER — STICKER CONVERSION PRICING
// ══════════════════════════════════════════════════════════════
async function openNftPricingModal() {
  const res = await fetch(withAuth(`${API_BASE}/api/admin/nft-settings`));
  if (res.ok) {
    const d = await res.json();
    document.getElementById("np-user-price").value = d.user_price;
    document.getElementById("np-reseller-price").value = d.reseller_price;
  }
  document.getElementById("np-status").textContent = "";
  document.getElementById("nft-pricing-modal").classList.remove("hidden");
}

function closeNftPricingModal() { document.getElementById("nft-pricing-modal").classList.add("hidden"); }

async function saveNftPricing() {
  const status = document.getElementById("np-status");
  const userPrice = document.getElementById("np-user-price").value;
  const resellerPrice = document.getElementById("np-reseller-price").value;
  if (userPrice === "" || resellerPrice === "") { status.textContent = "Fill in both prices."; return; }

  status.style.color = "#8b8b9a";
  status.textContent = "Saving…";
  const res = await fetch(withAuth(`${API_BASE}/api/admin/nft-settings`), {
    method: "POST",
    body: JSON.stringify({ user_price: Number(userPrice), reseller_price: Number(resellerPrice) }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    status.style.color = "#ff6b6b";
    status.textContent = e.detail || "Failed.";
    return;
  }
  status.style.color = "#4ade80";
  status.textContent = "✅ Saved!";
  setTimeout(closeNftPricingModal, 600);
}

// ══════════════════════════════════════════════════════════════
// SHOP CATALOG
// ══════════════════════════════════════════════════════════════
async function loadGifts() {
  const res = await fetch(withAuth(`${API_BASE}/api/gifts`));
  if (!res.ok) { showError("Could not load gifts."); return; }
  renderGifts((await res.json()).gifts);
}

function renderGifts(gifts) {
  animInstances.forEach((a) => a.destroy());
  animInstances = [];

  const grid = document.getElementById("gift-grid");
  grid.innerHTML = "";

  if (!gifts.length) {
    grid.innerHTML = `<p class="empty-state">✨ No gifts available yet.</p>`;
    return;
  }

  gifts.forEach((gift) => {
    const card = document.createElement("div");
    card.className = "gift-card";
    card.onclick = () => openViewer(gift);

    const animBox = document.createElement("div");
    animBox.className = "gift-anim";
    card.appendChild(animBox);

    const name = document.createElement("div");
    name.className = "gift-name";
    name.textContent = `${gift.emoji || "🎁"} ${gift.name}`;
    card.appendChild(name);

    if (gift.price > 0) {
      const price = document.createElement("div");
      price.className = "gift-price";
      price.textContent = `${gift.price} ⭐`;
      card.appendChild(price);
    }

    grid.appendChild(card);

    if (gift.animation_url) {
      const anim = lottie.loadAnimation({ container: animBox, renderer: "svg", loop: true, autoplay: true, path: gift.animation_url });
      animInstances.push(anim);
    }
  });
}

// ══════════════════════════════════════════════════════════════
// GIFT DETAIL / BUY FLOW
// ══════════════════════════════════════════════════════════════
let viewerAnim = null;
let currentGift = null;
let buyForOther = false;
let currentOrderId = null;
let commentPollTimer = null;

function openViewer(gift) {
  currentGift = gift;
  currentOrderId = null;
  const box = document.getElementById("viewer-anim");
  box.innerHTML = "";
  document.getElementById("viewer-name").textContent = `${gift.emoji || "🎁"} ${gift.name}`;
  document.getElementById("viewer-price").textContent = gift.price > 0 ? `${gift.price} ⭐` : "";
  document.getElementById("buy-status").textContent = "";
  document.getElementById("comment-preview").classList.add("hidden");
  document.getElementById("comment-btn").textContent = "💬 Add Comment (via bot chat)";
  backToChoice();

  const canBuy = currentUser.role !== "owner" && currentUser.role !== "admin" && gift.price > 0;
  document.getElementById("buy-step-choice").classList.toggle("hidden", !canBuy);
  if (!canBuy) {
    document.getElementById("buy-status").style.color = "#8b8b9a";
    document.getElementById("buy-status").textContent = "Staff accounts can preview but not purchase.";
  }

  document.getElementById("viewer-modal").classList.remove("hidden");
  if (gift.animation_url) {
    viewerAnim = lottie.loadAnimation({ container: box, renderer: "svg", loop: true, autoplay: true, path: gift.animation_url });
  }
  tg.HapticFeedback?.impactOccurred("light");
}

function closeViewer() {
  document.getElementById("viewer-modal").classList.add("hidden");
  if (viewerAnim) { viewerAnim.destroy(); viewerAnim = null; }
  if (commentPollTimer) { clearInterval(commentPollTimer); commentPollTimer = null; }
  currentGift = null;
  currentOrderId = null;
}

async function startBuy(forOther) {
  buyForOther = forOther;
  const status = document.getElementById("buy-status");
  status.style.color = "#ff6b6b";
  status.textContent = "Creating order…";

  const res = await fetch(withAuth(`${API_BASE}/api/buy/start`), {
    method: "POST",
    body: JSON.stringify({ gift_db_id: currentGift.id, for_other: forOther }),
  });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    status.textContent = e.detail || "Could not create order.";
    return;
  }

  const data = await res.json();
  currentOrderId = data.order_id;
  status.textContent = "";

  document.getElementById("buy-step-choice").classList.add("hidden");
  document.getElementById("buy-step-comment").classList.remove("hidden");
}

function backToChoice() {
  document.getElementById("buy-step-comment").classList.add("hidden");
  document.getElementById("buy-step-choice").classList.remove("hidden");
  if (commentPollTimer) { clearInterval(commentPollTimer); commentPollTimer = null; }
}

async function requestComment() {
  if (!currentOrderId) return;
  const status = document.getElementById("buy-status");
  status.style.color = "#5b8cff";
  status.textContent = "Check your bot chat — type your comment there…";
  document.getElementById("comment-btn").textContent = "💬 Waiting for your message…";

  const res = await fetch(withAuth(`${API_BASE}/api/order/${currentOrderId}/request-comment`), {
    method: "POST",
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    status.style.color = "#ff6b6b";
    status.textContent = e.detail || "Could not send comment request.";
    return;
  }

  tg.HapticFeedback?.impactOccurred("light");

  if (commentPollTimer) clearInterval(commentPollTimer);
  commentPollTimer = setInterval(async () => {
    const r = await fetch(withAuth(`${API_BASE}/api/order/${currentOrderId}`));
    if (!r.ok) return;
    const d = await r.json();
    if (d.comment_text) {
      clearInterval(commentPollTimer);
      commentPollTimer = null;
      status.style.color = "#4ade80";
      status.textContent = "✅ Comment received!";
      document.getElementById("comment-btn").textContent = "✏️ Edit Comment (via bot chat)";
      const preview = document.getElementById("comment-preview");
      preview.textContent = d.comment_text;
      preview.classList.remove("hidden");
    }
  }, 2500);
}

async function goToPay() {
  if (!currentOrderId) return;
  const status = document.getElementById("buy-status");
  status.style.color = "#5b8cff";
  status.textContent = "Opening payment…";

  const res = await fetch(withAuth(`${API_BASE}/api/order/${currentOrderId}/pay`), {
    method: "POST",
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    status.style.color = "#ff6b6b";
    status.textContent = e.detail || "Could not start payment.";
    return;
  }

  const data = await res.json();
  tg.openInvoice(data.invoice_link, (paymentStatus) => {
    if (paymentStatus === "paid") {
      status.style.color = "#4ade80";
      status.textContent = buyForOther
        ? "✅ Paid! Check My Orders for the claim link."
        : "✅ Paid! Check your Telegram profile gifts.";
      tg.HapticFeedback?.notificationOccurred("success");
      setTimeout(() => { closeViewer(); loadGifts(); }, 1800);
    } else if (paymentStatus === "cancelled") {
      status.style.color = "#ff6b6b";
      status.textContent = "Payment cancelled.";
    } else if (paymentStatus === "failed") {
      status.style.color = "#ff6b6b";
      status.textContent = "Payment failed. Try again.";
    }
  });
}

// ══════════════════════════════════════════════════════════════
// MY ORDERS
// ══════════════════════════════════════════════════════════════
async function loadOrders() {
  const res = await fetch(withAuth(`${API_BASE}/api/orders`));
  const list = document.getElementById("orders-list");
  if (!res.ok) { list.innerHTML = `<p class="empty-state">Could not load orders.</p>`; return; }
  const data = await res.json();
  renderOrders(data.orders);
}

let orderAnimInstances = [];

function renderOrders(orders) {
  orderAnimInstances.forEach((a) => a.destroy());
  orderAnimInstances = [];

  const list = document.getElementById("orders-list");
  list.innerHTML = "";

  if (!orders.length) {
    list.innerHTML = `<p class="empty-state">📦 No orders yet — go buy something nice!</p>`;
    return;
  }

  orders.forEach((o) => {
    const row = document.createElement("div");
    row.className = "order-row";

    let claimHtml = "";
    if (o.for_other && o.claim_link && o.status !== "claimed") {
      claimHtml = `
        <div class="claim-link-box">
          <input readonly value="${o.claim_link}">
          <button onclick="copyLink('${o.claim_link}', this)">Copy</button>
        </div>`;
    }

    const statusLabel = o.status === "sent" ? "Delivered" : o.status.charAt(0).toUpperCase() + o.status.slice(1);
    const dateStr = new Date(o.created_at.replace(" ", "T") + "Z").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

    row.innerHTML = `
      <div class="order-top">
        <div class="thumb" id="order-thumb-${o.id}">${o.animation_url ? "" : (o.gift_emoji || "🎁")}</div>
        <div class="name">${escapeHtml(o.gift_name)}</div>
        <div class="price">${o.price} ⭐</div>
      </div>
      <span class="status-pill ${o.status}">${statusLabel}</span>
      <span class="status-pill" style="background:#ffffff12;color:#aaa;margin-left:6px;">${o.for_other ? "For someone else" : "For myself"}</span>
      <div class="order-meta">Order #${o.id} · ${dateStr}${o.claimed_by ? ` · Claimed by @${o.claimed_by}` : ""}</div>
      ${o.comment ? `<div class="order-comment">💬 ${escapeHtml(o.comment)}</div>` : ""}
      ${claimHtml}
    `;
    list.appendChild(row);

    if (o.animation_url) {
      const anim = lottie.loadAnimation({
        container: document.getElementById(`order-thumb-${o.id}`),
        renderer: "svg", loop: true, autoplay: true, path: o.animation_url,
      });
      orderAnimInstances.push(anim);
    }
  });
}

function copyLink(link, btn) {
  navigator.clipboard?.writeText(link);
  const original = btn.textContent;
  btn.textContent = "Copied!";
  setTimeout(() => (btn.textContent = original), 1200);
  tg.HapticFeedback?.impactOccurred("light");
}

// ══════════════════════════════════════════════════════════════
// ADMIN — GIFT MANAGEMENT
// ══════════════════════════════════════════════════════════════
async function loadAdminGifts() {
  const res = await fetch(withAuth(`${API_BASE}/api/admin/gifts`));
  if (!res.ok) return;
  renderAdminGifts((await res.json()).gifts);
}

function renderAdminGifts(gifts) {
  const list = document.getElementById("admin-gift-list");
  list.innerHTML = "";

  if (!gifts.length) {
    list.innerHTML = `<p class="empty-state">No gifts yet. Tap "＋ Add New Gift".</p>`;
    return;
  }

  gifts.forEach((g) => {
    const row = document.createElement("div");
    row.className = "list-row";
    row.innerHTML = `
      <div class="thumb">${g.emoji || "🎁"}</div>
      <div class="info">
        <div class="title">${escapeHtml(g.name)}</div>
        <div class="subtitle ${g.active ? "" : "inactive"}">
          ${g.player_price}⭐ / ${g.reseller_price}⭐ · ${g.active ? "Active" : "Hidden"}
        </div>
      </div>
      <div class="actions"></div>
    `;
    const actions = row.querySelector(".actions");

    const editBtn = document.createElement("button");
    editBtn.className = "pill-btn edit";
    editBtn.textContent = "Edit";
    editBtn.onclick = () => openGiftForm(g);
    actions.appendChild(editBtn);

    const toggleBtn = document.createElement("button");
    toggleBtn.className = `pill-btn ${g.active ? "danger" : "success"}`;
    toggleBtn.textContent = g.active ? "Hide" : "Show";
    toggleBtn.onclick = () => toggleGiftActive(g.id, g.active);
    actions.appendChild(toggleBtn);

    if (currentUser.role === "owner") {
      const delBtn = document.createElement("button");
      delBtn.className = "pill-btn danger";
      delBtn.textContent = "Delete";
      delBtn.onclick = () => deleteGiftPermanently(g.id, g.name);
      actions.appendChild(delBtn);
    }

    list.appendChild(row);
  });
}

async function toggleGiftActive(gid, isActive) {
  const path = isActive ? `gift/${gid}` : `gift/${gid}/reactivate`;
  const method = isActive ? "DELETE" : "POST";
  const res = await fetch(withAuth(`${API_BASE}/api/admin/${path}`), { method });
  if (res.ok) loadAdminGifts();
}

function deleteGiftPermanently(gid, name) {
  const doDelete = async () => {
    const res = await fetch(withAuth(`${API_BASE}/api/admin/gift/${gid}/hard-delete`), { method: "POST" });
    if (res.ok) loadAdminGifts();
  };
  if (tg.showConfirm) {
    tg.showConfirm(`Permanently delete "${name}"? This cannot be undone.`, (ok) => { if (ok) doDelete(); });
  } else if (confirm(`Permanently delete "${name}"? This cannot be undone.`)) {
    doDelete();
  }
}

function openGiftForm(gift = null) {
  editingGiftId = gift ? gift.id : null;
  fetchedAnimationJson = null;
  document.getElementById("gift-modal-title").textContent = gift ? "Edit Gift" : "Add New Gift";
  document.getElementById("gift-submit-btn").textContent = gift ? "Save" : "Upload";
  document.getElementById("f-name").value = gift ? gift.name : "";
  document.getElementById("f-giftid").value = gift ? gift.gift_id : "";
  document.getElementById("f-emoji").value = gift ? gift.emoji : "🎁";
  document.getElementById("f-player-price").value = gift ? gift.player_price : "";
  document.getElementById("f-reseller-price").value = gift ? gift.reseller_price : "";
  document.getElementById("f-giftid").disabled = !!gift;
  document.getElementById("file-label-note").textContent = gift ? "(leave empty to keep current)" : "";
  document.getElementById("f-file").value = "";
  document.getElementById("f-nft-link").value = "";
  document.getElementById("nft-fetch-status").textContent = "";
  document.getElementById("nft-preview-table").classList.add("hidden");
  document.getElementById("preview-box").classList.add("hidden");
  document.getElementById("upload-status").textContent = "";
  document.getElementById("gift-modal").classList.remove("hidden");
}

async function lookupNft() {
  const link = document.getElementById("f-nft-link").value.trim();
  const status = document.getElementById("nft-fetch-status");
  const table = document.getElementById("nft-preview-table");
  const btn = document.getElementById("nft-fetch-btn");

  if (!link) { status.style.color = "#ff6b6b"; status.textContent = "Paste an NFT link first."; return; }

  status.style.color = "#8b8b9a";
  status.textContent = "Fetching gift preview…";
  table.classList.add("hidden");
  btn.disabled = true;

  const res = await fetch(withAuth(`${API_BASE}/api/admin/gift/lookup-nft`), {
    method: "POST",
    body: JSON.stringify({ nft_link: link }),
  });
  btn.disabled = false;

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    status.style.color = "#ff6b6b";
    status.textContent = e.detail || "Lookup failed.";
    return;
  }

  const data = await res.json();

  if (data.status === "not_ready") {
    status.style.color = "#ffcf5c";
    status.textContent = data.message;
    return;
  }

  status.style.color = "#4ade80";
  status.textContent = "✅ Preview loaded!";

  table.classList.remove("hidden");
  table.innerHTML = `
    ${data.owner ? `<div class="row"><span class="label">Owner</span><span class="value">${escapeHtml(data.owner)}</span></div>` : ""}
    ${data.model ? `<div class="row"><span class="label">Model</span><span class="value">${escapeHtml(data.model)}</span></div>` : ""}
    ${data.backdrop ? `<div class="row"><span class="label">Backdrop</span><span class="value">${escapeHtml(data.backdrop)}</span></div>` : ""}
    ${data.symbol ? `<div class="row"><span class="label">Symbol</span><span class="value">${escapeHtml(data.symbol)}</span></div>` : ""}
    ${data.quantity ? `<div class="row"><span class="label">Quantity</span><span class="value">${escapeHtml(data.quantity)} issued</span></div>` : ""}
  `;

  document.getElementById("f-name").value = data.name || data.slug;
  document.getElementById("f-giftid").value = data.slug;

  fetchedAnimationJson = data.animation_json;
  const box = document.getElementById("preview-box");
  box.classList.remove("hidden");
  box.innerHTML = "";
  if (previewAnim) previewAnim.destroy();
  try {
    const animData = JSON.parse(data.animation_json);
    previewAnim = lottie.loadAnimation({ container: box, renderer: "svg", loop: true, autoplay: true, animationData: animData });
  } catch {}
}

function closeGiftForm() {
  document.getElementById("gift-modal").classList.add("hidden");
  if (previewAnim) { previewAnim.destroy(); previewAnim = null; }
}

document.getElementById("f-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  const box = document.getElementById("preview-box");
  if (!file) return;
  fetchedAnimationJson = null; // manual file overrides any Fragment fetch
  box.classList.remove("hidden");
  box.innerHTML = "";
  if (previewAnim) previewAnim.destroy();
  try {
    const json = JSON.parse(await file.text());
    previewAnim = lottie.loadAnimation({ container: box, renderer: "svg", loop: true, autoplay: true, animationData: json });
  } catch {
    box.innerHTML = `<span style="color:#ff6b6b;font-size:12px;">Invalid JSON file</span>`;
  }
});

async function submitGift() {
  const name = document.getElementById("f-name").value.trim();
  const giftId = document.getElementById("f-giftid").value.trim();
  const emoji = document.getElementById("f-emoji").value.trim() || "🎁";
  const playerPrice = document.getElementById("f-player-price").value;
  const resellerPrice = document.getElementById("f-reseller-price").value;
  const file = document.getElementById("f-file").files[0];
  const status = document.getElementById("upload-status");
  const isEdit = editingGiftId !== null;

  if (!name || !giftId || !playerPrice || !resellerPrice || (!isEdit && !file && !fetchedAnimationJson)) {
    status.textContent = "Fill in all fields and provide an animation (upload a file or fetch by NFT link).";
    return;
  }

  status.style.color = "#8b8b9a";
  status.textContent = isEdit ? "Saving…" : "Uploading…";

  const form = new FormData();
  form.append("name", name);
  form.append("emoji", emoji);
  form.append("player_price", playerPrice);
  form.append("reseller_price", resellerPrice);
  if (!isEdit) form.append("gift_id", giftId);
  if (fetchedAnimationJson) {
    form.append("animation_json", fetchedAnimationJson);
  } else if (file) {
    form.append("animation", file);
  }

  const url = isEdit ? `${API_BASE}/api/admin/gift/${editingGiftId}` : `${API_BASE}/api/admin/gift`;
  const res = await fetch(withAuth(url), { method: isEdit ? "PATCH" : "POST", body: form });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    status.style.color = "#ff6b6b";
    status.textContent = e.detail || "Failed.";
    return;
  }

  status.style.color = "#4ade80";
  status.textContent = isEdit ? "✅ Saved!" : "✅ Gift added!";
  setTimeout(() => { closeGiftForm(); loadAdminGifts(); loadGifts(); }, 600);
}

// ══════════════════════════════════════════════════════════════
// ADMIN — USER MANAGEMENT (grouped by role)
// ══════════════════════════════════════════════════════════════
const ROLE_ORDER = ["user", "reseller", "admin", "owner"];
const ROLE_LABELS = { user: "👤 Users", reseller: "🏪 Resellers", admin: "🛠️ Admins", owner: "👑 Owner" };
let allUsers = [];

async function loadUsers() {
  const res = await fetch(withAuth(`${API_BASE}/api/admin/users`));
  if (!res.ok) return;
  allUsers = (await res.json()).users;
  renderUsers(allUsers);
}

function filterUsers() {
  const q = document.getElementById("user-search").value.trim().toLowerCase().replace(/^@/, "");
  if (!q) { renderUsers(allUsers); return; }
  renderUsers(allUsers.filter((u) =>
    String(u.user_id).includes(q) ||
    (u.username || "").toLowerCase().includes(q) ||
    (u.first_name || "").toLowerCase().includes(q)
  ));
}

function renderUsers(users) {
  const list = document.getElementById("user-list");
  list.innerHTML = "";

  if (!users.length) {
    list.innerHTML = `<p class="empty-state">No users found.</p>`;
    return;
  }

  const grouped = {};
  ROLE_ORDER.forEach((r) => (grouped[r] = []));
  users.forEach((u) => grouped[u.role]?.push(u));

  ROLE_ORDER.forEach((roleKey) => {
    const group = grouped[roleKey];
    if (!group.length) return;
    const header = document.createElement("div");
    header.className = "group-header";
    header.textContent = `${ROLE_LABELS[roleKey]} (${group.length})`;
    list.appendChild(header);
    group.forEach((u) => list.appendChild(buildUserRow(u)));
  });
}

function buildUserRow(u) {
  const row = document.createElement("div");
  row.className = "list-row";
  const displayName = u.username ? `@${u.username}` : (u.first_name || `#${u.user_id}`);
  row.innerHTML = `
    <div class="thumb">👤</div>
    <div class="info">
      <div class="title">${escapeHtml(displayName)} <span style="color:#666;font-weight:400;">#${u.user_id}</span></div>
      <div class="subtitle">
        <span class="badge-role ${u.role}">${u.role}</span>
        ${u.banned ? `<span class="badge-role banned">banned</span>` : ""}
      </div>
    </div>
    <div class="actions"></div>
  `;
  const actions = row.querySelector(".actions");

  if (!u.is_owner) {
    const roleBtn = document.createElement("button");
    roleBtn.className = "pill-btn neutral";
    roleBtn.textContent = "Role";
    roleBtn.onclick = () => openRoleModal(u);
    actions.appendChild(roleBtn);

    const banBtn = document.createElement("button");
    banBtn.className = `pill-btn ${u.banned ? "success" : "danger"}`;
    banBtn.textContent = u.banned ? "Unban" : "Ban";
    banBtn.onclick = () => toggleBan(u.user_id, u.banned);
    actions.appendChild(banBtn);
  }

  return row;
}

async function toggleBan(uid, isBanned) {
  const path = isBanned ? "unban" : "ban";
  const res = await fetch(withAuth(`${API_BASE}/api/admin/users/${uid}/${path}`), { method: "POST" });
  if (res.ok) { await loadUsers(); filterUsers(); }
}

let roleTargetUid = null;

function openRoleModal(u) {
  roleTargetUid = u.user_id;
  document.getElementById("role-target-name").textContent = u.username ? `@${u.username}` : (u.first_name || `#${u.user_id}`);
  const opts = document.getElementById("role-options");
  opts.innerHTML = "";
  const roles = currentUser.role === "owner" ? ["user", "reseller", "admin"] : ["user", "reseller"];
  roles.forEach((r) => {
    const btn = document.createElement("button");
    btn.className = "role-option-btn" + (r === u.role ? " current" : "");
    btn.textContent = r.charAt(0).toUpperCase() + r.slice(1);
    btn.onclick = () => setRole(r);
    opts.appendChild(btn);
  });
  document.getElementById("role-modal").classList.remove("hidden");
}

function closeRoleModal() { document.getElementById("role-modal").classList.add("hidden"); }

async function setRole(role) {
  const res = await fetch(withAuth(`${API_BASE}/api/admin/users/${roleTargetUid}/role`), {
    method: "POST",
    body: JSON.stringify({ role }),
  });
  if (res.ok) { closeRoleModal(); await loadUsers(); filterUsers(); }
}

// ══════════════════════════════════════════════════════════════
// ADD USER BY ID
// ══════════════════════════════════════════════════════════════
function openAddUserForm() {
  document.getElementById("au-userid").value = "";
  document.getElementById("add-user-status").textContent = "";
  const opts = document.getElementById("au-role-options");
  opts.innerHTML = "";
  const roles = currentUser.role === "owner" ? ["user", "reseller", "admin"] : ["user", "reseller"];
  roles.forEach((r, i) => {
    const btn = document.createElement("button");
    btn.className = "role-option-btn" + (i === 0 ? " current" : "");
    btn.textContent = r.charAt(0).toUpperCase() + r.slice(1);
    btn.dataset.role = r;
    btn.onclick = () => {
      opts.querySelectorAll(".role-option-btn").forEach((b) => b.classList.remove("current"));
      btn.classList.add("current");
    };
    opts.appendChild(btn);
  });
  document.getElementById("add-user-modal").classList.remove("hidden");
}

function closeAddUserForm() { document.getElementById("add-user-modal").classList.add("hidden"); }

async function submitAddUser() {
  const uid = document.getElementById("au-userid").value.trim();
  const status = document.getElementById("add-user-status");
  const selected = document.querySelector("#au-role-options .role-option-btn.current");
  const role = selected ? selected.dataset.role : "reseller";

  if (!uid) { status.textContent = "Enter a Telegram user ID."; return; }

  status.style.color = "#8b8b9a";
  status.textContent = "Adding…";
  const res = await fetch(withAuth(`${API_BASE}/api/admin/users`), {
    method: "POST",
    body: JSON.stringify({ user_id: Number(uid), role }),
  });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    status.style.color = "#ff6b6b";
    status.textContent = e.detail || "Failed to add user.";
    return;
  }

  status.style.color = "#4ade80";
  status.textContent = "✅ Added!";
  setTimeout(() => { closeAddUserForm(); loadUsers(); }, 500);
}

// ══════════════════════════════════════════════════════════════
// UTIL
// ══════════════════════════════════════════════════════════════
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

authenticate();
