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
  checkGwCreateAccess();
  document.getElementById("loading").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  checkGwDeepLink();
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
  ["shop", "orders", "convert", "giveaways", "gifts", "users"].forEach((t) => {
    document.getElementById(`tab-${t}`).classList.toggle("hidden", t !== tab);
  });
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));

  const titles = { shop: "Gifts Shop", orders: "My Orders", convert: "NFT to Sticker", giveaways: "Giveaways", gifts: "Manage Gifts", users: "Manage Users" };
  document.getElementById("page-title").textContent = titles[tab];

  if (tab === "orders") loadOrders();
  if (tab === "giveaways") loadGiveaways();
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
let lastGifts = [];

async function loadGifts() {
  const res = await fetch(withAuth(`${API_BASE}/api/gifts`));
  if (!res.ok) { showError("Could not load gifts."); return; }
  lastGifts = (await res.json()).gifts;
  renderGifts(lastGifts);
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
    if (cart[gift.id]) card.classList.add("selected");

    const badge = document.createElement("div");
    badge.className = "check-badge";
    badge.textContent = "✓";
    card.appendChild(badge);

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

    let anim = null;
    if (gift.animation_url) {
      // Paused at frame 0 by default — many simultaneous looping Lottie
      // animations in a grid is what actually causes lag on weaker
      // devices. Playing once on selection keeps things smooth while
      // still giving a satisfying preview.
      anim = lottie.loadAnimation({
        container: animBox, renderer: "svg", loop: false, autoplay: false, path: gift.animation_url,
      });
      animInstances.push(anim);
    }

    card.onclick = () => {
      if (cart[gift.id]) {
        delete cart[gift.id];
        card.classList.remove("selected");
      } else {
        cart[gift.id] = { gift, quantity: 1, comment_text: "", comment_html: "", item_id: null };
        card.classList.add("selected");
        if (anim) anim.goToAndPlay(0, true);
      }
      tg.HapticFeedback?.selectionChanged();
      updateCartFab();
    };
  });
}

// ══════════════════════════════════════════════════════════════
// CART
// ══════════════════════════════════════════════════════════════
let cart = {}; // { [gift_db_id]: {gift, quantity, comment_text, comment_html, item_id} }
let cartForOther = null;
let cartOrderId = null;

function cartCount() {
  return Object.values(cart).reduce((sum, l) => sum + l.quantity, 0);
}
function cartTotal() {
  return Object.values(cart).reduce((sum, l) => sum + l.gift.price * l.quantity, 0);
}

function updateCartFab() {
  const fab = document.getElementById("cart-fab");
  const count = cartCount();
  if (count === 0) { fab.classList.add("hidden"); return; }
  fab.classList.remove("hidden");
  document.getElementById("cart-fab-count").textContent = count;
  document.getElementById("cart-fab-price").textContent = cartTotal();
}

function openCart() {
  cartForOther = null;
  document.getElementById("cart-status").textContent = "";
  document.getElementById("cart-step-checkout").classList.add("hidden");
  document.getElementById("cart-step-review").classList.add("hidden");
  document.getElementById("cart-step-recipient").classList.remove("hidden");
  document.getElementById("cart-modal").classList.remove("hidden");
}

function closeCart() {
  document.getElementById("cart-modal").classList.add("hidden");
}

function setCartRecipient(forOther) {
  cartForOther = forOther;
  document.getElementById("cart-step-recipient").classList.add("hidden");
  document.getElementById("cart-step-review").classList.remove("hidden");
  renderCartReview();
}

function renderCartReview() {
  const container = document.getElementById("cart-lines");
  container.innerHTML = "";

  Object.values(cart).forEach((line) => {
    const div = document.createElement("div");
    div.className = "cart-line";
    div.innerHTML = `
      <div class="cart-line-top">
        <div class="cart-line-thumb" id="cart-thumb-${line.gift.id}"></div>
        <div class="cart-line-name">${line.gift.emoji || "🎁"} ${escapeHtml(line.gift.name)}</div>
        <div class="cart-line-subtotal">${line.gift.price * line.quantity} ⭐</div>
      </div>
      <div class="qty-control">
        <button class="qty-btn" onclick="changeQty(${line.gift.id}, -1)">−</button>
        <span class="qty-value">${line.quantity}</span>
        <button class="qty-btn" onclick="changeQty(${line.gift.id}, 1)">+</button>
      </div>
      <div class="cart-line-actions">
        <button class="pill-btn danger" onclick="removeFromCart(${line.gift.id})">Remove</button>
      </div>
    `;
    container.appendChild(div);

    if (line.gift.animation_url) {
      lottie.loadAnimation({
        container: document.getElementById(`cart-thumb-${line.gift.id}`),
        renderer: "svg", loop: true, autoplay: true, path: line.gift.animation_url,
      });
    }
  });

  document.getElementById("cart-total-items").textContent = `${cartCount()} gifts`;
  document.getElementById("cart-total-price").textContent = `${cartTotal()} ⭐`;
}

function changeQty(giftId, delta) {
  const line = cart[giftId];
  if (!line) return;
  line.quantity = Math.max(1, line.quantity + delta);
  renderCartReview();
  updateCartFab();
}

function removeFromCart(giftId) {
  delete cart[giftId];
  renderCartReview();
  updateCartFab();
  renderGifts(lastGifts); // refresh shop grid selection state
  if (Object.keys(cart).length === 0) closeCart();
}

async function proceedToCheckout() {
  const status = document.getElementById("cart-status");
  status.style.color = "#8b8b9a";
  status.textContent = "Creating your order…";

  const items = Object.values(cart).map((l) => ({ gift_db_id: l.gift.id, quantity: l.quantity }));
  const res = await fetch(withAuth(`${API_BASE}/api/cart/start`), {
    method: "POST",
    body: JSON.stringify({ items, for_other: cartForOther }),
  });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    status.style.color = "#ff6b6b";
    status.textContent = e.detail || "Could not create order.";
    return;
  }

  const data = await res.json();
  cartOrderId = data.cart_order_id;
  data.items.forEach((it) => { if (cart[it.gift_db_id]) cart[it.gift_db_id].item_id = it.item_id; });

  status.textContent = "";
  document.getElementById("cart-step-review").classList.add("hidden");
  document.getElementById("cart-step-checkout").classList.remove("hidden");
  renderCheckoutLines();
}

function renderCheckoutLines() {
  const container = document.getElementById("checkout-lines");
  container.innerHTML = "";

  Object.values(cart).forEach((line) => {
    const div = document.createElement("div");
    div.className = "cart-line";
    div.innerHTML = `
      <div class="cart-line-top">
        <div class="cart-line-thumb" id="checkout-thumb-${line.gift.id}"></div>
        <div class="cart-line-name">${line.gift.emoji || "🎁"} ${escapeHtml(line.gift.name)} ×${line.quantity}</div>
        <div class="cart-line-subtotal">${line.gift.price * line.quantity} ⭐</div>
      </div>
      ${line.comment_text ? `<div class="cart-line-comment">💬 ${escapeHtml(line.comment_text)}</div>` : ""}
      <div class="cart-line-actions">
        <button class="pill-btn neutral" onclick="requestCartComment(${line.gift.id})">
          ${line.comment_text ? "✏️ Edit Comment" : "💬 Add Comment"}
        </button>
      </div>
    `;
    container.appendChild(div);

    if (line.gift.animation_url) {
      lottie.loadAnimation({
        container: document.getElementById(`checkout-thumb-${line.gift.id}`),
        renderer: "svg", loop: true, autoplay: true, path: line.gift.animation_url,
      });
    }
  });

  document.getElementById("checkout-total-items").textContent = `${cartCount()} gifts`;
  document.getElementById("checkout-total-price").textContent = `${cartTotal()} ⭐`;
}

let cartCommentPollTimer = null;

async function requestCartComment(giftId) {
  const line = cart[giftId];
  if (!line || !line.item_id) return;
  const status = document.getElementById("cart-status");
  status.style.color = "#5b8cff";
  status.textContent = `Check your bot chat — type your comment for ${line.gift.name}…`;

  const res = await fetch(withAuth(`${API_BASE}/api/cart/item/${line.item_id}/request-comment`), { method: "POST" });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    status.style.color = "#ff6b6b";
    status.textContent = e.detail || "Could not send comment request.";
    return;
  }
  tg.HapticFeedback?.impactOccurred("light");

  if (cartCommentPollTimer) clearInterval(cartCommentPollTimer);
  cartCommentPollTimer = setInterval(async () => {
    const r = await fetch(withAuth(`${API_BASE}/api/cart/item/${line.item_id}`));
    if (!r.ok) return;
    const d = await r.json();
    if (d.comment_text) {
      clearInterval(cartCommentPollTimer);
      cartCommentPollTimer = null;
      line.comment_text = d.comment_text;
      status.style.color = "#4ade80";
      status.textContent = "✅ Comment received!";
      renderCheckoutLines();
    }
  }, 2500);
}

async function payCart() {
  const status = document.getElementById("cart-status");
  status.style.color = "#5b8cff";
  status.textContent = "Opening payment…";

  const res = await fetch(withAuth(`${API_BASE}/api/cart/${cartOrderId}/pay`), { method: "POST" });
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
      status.textContent = cartForOther
        ? "✅ Paid! Check My Orders for the claim link."
        : "✅ Paid! Check your Telegram profile gifts.";
      tg.HapticFeedback?.notificationOccurred("success");
      cart = {};
      updateCartFab();
      setTimeout(() => { closeCart(); loadGifts(); }, 1800);
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

// ══════════════════════════════════════════════════════════════
// GIVEAWAYS
// ══════════════════════════════════════════════════════════════
let gwAnimInstances = [];
let gwCountdownTimers = {};
let currentGwId = null;
let gwCart = {}; // { [gift_db_id]: {gift, quantity} }
let gwChannel = null;
let gwCreatedId = null;
let gwCommentPollTimer = null;

async function checkGwCreateAccess() {
  const res = await fetch(withAuth(`${API_BASE}/api/giveaways/my-channels`));
  if (!res.ok) return;
  const data = await res.json();
  if (data.channels.length > 0) {
    document.getElementById("gw-create-btn").classList.remove("hidden");
  }
}

async function loadGiveaways() {
  const res = await fetch(withAuth(`${API_BASE}/api/giveaways`));
  const list = document.getElementById("gw-list");
  Object.values(gwCountdownTimers).forEach(clearInterval);
  gwCountdownTimers = {};
  if (!res.ok) { list.innerHTML = `<p class="empty-state">Could not load giveaways.</p>`; return; }
  const data = await res.json();
  renderGiveaways(data.giveaways);
}

function renderGiveaways(giveaways) {
  gwAnimInstances.forEach((a) => a.destroy());
  gwAnimInstances = [];
  const list = document.getElementById("gw-list");
  list.innerHTML = "";

  if (!giveaways.length) {
    list.innerHTML = `<p class="empty-state">🎉 No giveaways running right now.</p>`;
    return;
  }

  giveaways.forEach((gw) => {
    const row = document.createElement("div");
    row.className = "list-row";
    row.style.cursor = "pointer";
    row.onclick = () => openGwDetail(gw.id);

    const giftIcons = gw.gifts.slice(0, 3).map((g) => g.emoji || "🎁").join(" ");
    const statusLabel = gw.status === "ended" ? "Ended" : "Active";

    row.innerHTML = `
      <div class="thumb">${giftIcons}</div>
      <div class="info">
        <div class="title">${escapeHtml(gw.channel_title)}</div>
        <div class="subtitle">
          🎁 ${gw.total_prizes} prizes · 👥 ${gw.participants_count}
          <span class="status-pill ${gw.status === "ended" ? "claimed" : "paid"}">${statusLabel}</span>
        </div>
      </div>
      <div class="actions"><span id="gw-countdown-${gw.id}" style="font-size:11px;color:#ffcf5c;font-weight:700;"></span></div>
    `;
    list.appendChild(row);

    if (gw.status === "active") {
      const el = document.getElementById(`gw-countdown-${gw.id}`);
      let remaining = gw.remaining_secs;
      const update = () => {
        remaining = Math.max(0, remaining - 1);
        el.textContent = fmtDuration(remaining);
        if (remaining <= 0) { clearInterval(gwCountdownTimers[gw.id]); loadGiveaways(); }
      };
      update();
      gwCountdownTimers[gw.id] = setInterval(update, 1000);
    } else {
      const el = document.getElementById(`gw-countdown-${gw.id}`);
      if (el) el.textContent = "";
    }
  });
}

function fmtDuration(secs) {
  if (secs <= 0) return "Ended";
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m`;
}

let gwDetailTimer = null;

async function openGwDetail(gid) {
  currentGwId = gid;
  const res = await fetch(withAuth(`${API_BASE}/api/giveaways/${gid}`));
  if (!res.ok) return;
  const gw = await res.json();
  renderGwDetail(gw);
  document.getElementById("gw-detail-modal").classList.remove("hidden");
}

function renderGwDetail(gw) {
  document.getElementById("gwd-title").textContent = gw.status === "ended" ? "🏆 Giveaway Results" : "🎉 Giveaway";
  document.getElementById("gwd-channel").textContent = gw.channel_title;
  document.getElementById("gwd-status").textContent = "";

  const giftsBox = document.getElementById("gwd-gifts");
  giftsBox.innerHTML = gw.gifts.map((g) => `
    <div class="row"><span class="label">${g.emoji || "🎁"} ${escapeHtml(g.name)}</span><span class="value">×${g.quantity}</span></div>
  `).join("");

  document.getElementById("gwd-participants").textContent =
    `👥 ${gw.participants_count} participants` + (gw.require_join ? ` · Must join ${gw.channel_username ? "@" + gw.channel_username : "the channel"}` : "");

  const winnersBox = document.getElementById("gwd-winners");
  const enterBtn = document.getElementById("gwd-enter-btn");
  const timerEl = document.getElementById("gwd-timer");

  if (gwDetailTimer) clearInterval(gwDetailTimer);

  if (gw.status === "ended") {
    timerEl.textContent = "Ended";
    enterBtn.classList.add("hidden");
    winnersBox.classList.remove("hidden");
    winnersBox.innerHTML = gw.winners.length
      ? `<div class="group-header">Winners</div>` + gw.winners.map((w) =>
          `<div class="cart-line"><div class="cart-line-top"><div class="cart-line-name">${w.username ? "@" + escapeHtml(w.username) : escapeHtml(w.first_name || "User")}</div><div class="cart-line-subtotal">${w.gift_emoji || "🎁"} ${escapeHtml(w.gift_name || "")}</div></div></div>`
        ).join("")
      : `<p class="empty-state">No participants — no winners this time.</p>`;
  } else {
    winnersBox.classList.add("hidden");
    enterBtn.classList.remove("hidden");
    enterBtn.textContent = gw.user_entered ? "✅ Already Entered" : "🎁 Enter Giveaway";
    enterBtn.disabled = gw.user_entered;
    let remaining = gw.remaining_secs;
    const update = () => {
      timerEl.textContent = `⏱ ${fmtDuration(remaining)} left`;
      remaining = Math.max(0, remaining - 1);
      if (remaining <= 0) clearInterval(gwDetailTimer);
    };
    update();
    gwDetailTimer = setInterval(update, 1000);
  }
}

function closeGwDetail() {
  document.getElementById("gw-detail-modal").classList.add("hidden");
  if (gwDetailTimer) { clearInterval(gwDetailTimer); gwDetailTimer = null; }
}

async function enterGiveaway() {
  const status = document.getElementById("gwd-status");
  status.style.color = "#5b8cff";
  status.textContent = "Entering…";
  const res = await fetch(withAuth(`${API_BASE}/api/giveaways/${currentGwId}/enter`), { method: "POST" });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    status.style.color = "#ff6b6b";
    status.textContent = e.detail || "Could not enter.";
    return;
  }
  status.style.color = "#4ade80";
  status.textContent = "🎉 You're entered! Good luck!";
  tg.HapticFeedback?.notificationOccurred("success");
  document.getElementById("gwd-enter-btn").textContent = "✅ Already Entered";
  document.getElementById("gwd-enter-btn").disabled = true;
}

// ── Create flow ──────────────────────────────────────────────
async function openGwCreate() {
  gwCart = {};
  gwChannel = null;
  gwCreatedId = null;
  document.getElementById("gwc-status").textContent = "";
  document.getElementById("gwc-step-gifts").classList.add("hidden");
  document.getElementById("gwc-step-channel").classList.remove("hidden");

  const res = await fetch(withAuth(`${API_BASE}/api/giveaways/my-channels`));
  const data = await res.json();
  const list = document.getElementById("gwc-channel-list");
  list.innerHTML = "";
  data.channels.forEach((ch) => {
    const btn = document.createElement("button");
    btn.className = "role-option-btn";
    btn.textContent = `${ch.type === "channel" ? "📢" : "👥"} ${ch.title}`;
    btn.onclick = () => selectGwChannel(ch);
    list.appendChild(btn);
  });

  document.getElementById("gw-create-modal").classList.remove("hidden");
}

function closeGwCreate() {
  document.getElementById("gw-create-modal").classList.add("hidden");
  if (gwCommentPollTimer) { clearInterval(gwCommentPollTimer); gwCommentPollTimer = null; }
}

function selectGwChannel(ch) {
  gwChannel = ch;
  document.getElementById("gwc-step-channel").classList.add("hidden");
  document.getElementById("gwc-step-gifts").classList.remove("hidden");
  renderGwGiftGrid();
}

function renderGwGiftGrid() {
  const grid = document.getElementById("gwc-gift-grid");
  grid.innerHTML = "";
  lastGifts.forEach((gift) => {
    const card = document.createElement("div");
    card.className = "gift-card";
    if (gwCart[gift.id]) card.classList.add("selected");
    card.innerHTML = `<div class="check-badge">✓</div><div class="gift-anim" id="gwc-anim-${gift.id}"></div><div class="gift-name">${gift.emoji || "🎁"} ${escapeHtml(gift.name)}</div>`;
    card.onclick = () => {
      if (gwCart[gift.id]) delete gwCart[gift.id];
      else gwCart[gift.id] = { gift, quantity: 1 };
      renderGwGiftGrid();
      renderGwCartLines();
    };
    grid.appendChild(card);
    if (gift.animation_url) {
      lottie.loadAnimation({ container: document.getElementById(`gwc-anim-${gift.id}`), renderer: "svg", loop: false, autoplay: gwCart[gift.id] ? true : false, path: gift.animation_url });
    }
  });
}

function renderGwCartLines() {
  const container = document.getElementById("gwc-cart-lines");
  container.innerHTML = "";
  let totalQty = 0, totalPrice = 0;
  Object.values(gwCart).forEach((line) => {
    totalQty += line.quantity;
    totalPrice += (line.gift.price || 0) * line.quantity;
    const div = document.createElement("div");
    div.className = "cart-line";
    div.innerHTML = `
      <div class="cart-line-top">
        <div class="cart-line-name">${line.gift.emoji || "🎁"} ${escapeHtml(line.gift.name)}</div>
      </div>
      <div class="qty-control">
        <button class="qty-btn" onclick="changeGwQty(${line.gift.id}, -1)">−</button>
        <span class="qty-value">${line.quantity}</span>
        <button class="qty-btn" onclick="changeGwQty(${line.gift.id}, 1)">+</button>
      </div>
    `;
    container.appendChild(div);
  });
  document.getElementById("gwc-total-prizes").textContent = `${totalQty} prizes`;
  document.getElementById("gwc-total-price").textContent = `${totalPrice} ⭐`;
}

function changeGwQty(giftId, delta) {
  const line = gwCart[giftId];
  if (!line) return;
  line.quantity = Math.max(1, line.quantity + delta);
  renderGwCartLines();
}

async function gwRequestComment() {
  const status = document.getElementById("gwc-status");
  if (!gwCreatedId) {
    // Create the giveaway (pending) first so we have an id to attach the comment to
    const created = await createGwPending();
    if (!created) return;
  }
  status.style.color = "#5b8cff";
  status.textContent = "Check your bot chat — type your comment…";
  document.getElementById("gwc-comment-btn").disabled = true;

  const res = await fetch(withAuth(`${API_BASE}/api/giveaways/${gwCreatedId}/request-comment`), { method: "POST" });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    status.style.color = "#ff6b6b";
    status.textContent = e.detail || "Could not send request.";
    document.getElementById("gwc-comment-btn").disabled = false;
    return;
  }
  if (gwCommentPollTimer) clearInterval(gwCommentPollTimer);
  gwCommentPollTimer = setInterval(async () => {
    const r = await fetch(withAuth(`${API_BASE}/api/giveaways/${gwCreatedId}`));
    if (!r.ok) return;
    const d = await r.json();
    if (d.comment_html) {
      clearInterval(gwCommentPollTimer);
      gwCommentPollTimer = null;
      status.style.color = "#4ade80";
      status.textContent = "✅ Comment saved!";
      document.getElementById("gwc-comment-btn").textContent = "✏️ Edit Comment";
      document.getElementById("gwc-comment-btn").disabled = false;
    }
  }, 2500);
}

async function createGwPending() {
  const status = document.getElementById("gwc-status");
  const items = Object.values(gwCart).map((l) => ({ gift_db_id: l.gift.id, quantity: l.quantity }));
  if (!items.length) { status.style.color = "#ff6b6b"; status.textContent = "Select at least one gift."; return false; }

  const durationHours = parseFloat(document.getElementById("gwc-duration").value) || 24;
  const requireJoin = document.getElementById("gwc-require-join").checked;

  const res = await fetch(withAuth(`${API_BASE}/api/giveaways/create`), {
    method: "POST",
    body: JSON.stringify({
      channel_id: gwChannel.chat_id, items,
      duration_seconds: Math.round(durationHours * 3600),
      require_join: requireJoin,
    }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    status.style.color = "#ff6b6b";
    status.textContent = e.detail || "Could not create giveaway.";
    return false;
  }
  const data = await res.json();
  gwCreatedId = data.giveaway_id;
  return true;
}

async function gwCheckout() {
  const status = document.getElementById("gwc-status");
  if (!gwCreatedId) {
    const created = await createGwPending();
    if (!created) return;
  }

  status.style.color = "#5b8cff";
  status.textContent = "Posting giveaway…";

  const res = await fetch(withAuth(`${API_BASE}/api/giveaways/${gwCreatedId}/checkout`), { method: "POST" });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    status.style.color = "#ff6b6b";
    status.textContent = e.detail || "Could not post giveaway.";
    return;
  }
  const data = await res.json();

  if (data.free) {
    status.style.color = "#4ade80";
    status.textContent = "✅ Giveaway posted to your channel!";
    tg.HapticFeedback?.notificationOccurred("success");
    setTimeout(() => { closeGwCreate(); loadGiveaways(); }, 1500);
    return;
  }

  tg.openInvoice(data.invoice_link, (paymentStatus) => {
    if (paymentStatus === "paid") {
      status.style.color = "#4ade80";
      status.textContent = "✅ Paid! Giveaway posted to your channel.";
      tg.HapticFeedback?.notificationOccurred("success");
      setTimeout(() => { closeGwCreate(); loadGiveaways(); }, 1500);
    } else if (paymentStatus === "cancelled") {
      status.style.color = "#ff6b6b";
      status.textContent = "Payment cancelled.";
    } else if (paymentStatus === "failed") {
      status.style.color = "#ff6b6b";
      status.textContent = "Payment failed. Try again.";
    }
  });
}

// If launched from a channel's "Enter Giveaway" button (startapp=gw_<id>),
// jump straight to that giveaway's detail screen.
function checkGwDeepLink() {
  const startParam = tg.initDataUnsafe?.start_param || "";
  if (startParam.startsWith("gw_")) {
    const gid = startParam.slice(3);
    switchTab("giveaways");
    setTimeout(() => openGwDetail(gid), 300);
  }
}

authenticate();
