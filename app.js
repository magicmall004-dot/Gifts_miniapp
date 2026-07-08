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
let editingGiftId = null; // null = "add" mode, else "edit" mode

// ══════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════
async function authenticate() {
  const initData = tg.initData;
  if (!initData) {
    showError("Open this app from within Telegram.");
    return;
  }
  const res = await fetch(`${API_BASE}/api/auth`, {
    method: "POST",
    headers: { "X-Telegram-Init-Data": initData },
  });
  if (res.status === 403) {
    showError("You are banned from this shop.");
    return;
  }
  if (!res.ok) {
    showError("Login failed. Please reopen the app.");
    return;
  }
  currentUser = await res.json();
  document.getElementById("role-badge").textContent = currentUser.role;

  if (currentUser.role === "owner" || currentUser.role === "admin") {
    document.getElementById("nav-gifts").classList.remove("hidden");
    document.getElementById("nav-users").classList.remove("hidden");
  }

  await loadGifts();
  document.getElementById("loading").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
}

function showError(msg) {
  document.getElementById("loading").classList.add("hidden");
  document.getElementById("error-text").textContent = msg;
  document.getElementById("error").classList.remove("hidden");
}

function authHeaders(extra = {}) {
  return { "X-Telegram-Init-Data": tg.initData, ...extra };
}

// ══════════════════════════════════════════════════════════════
// TAB NAVIGATION
// ══════════════════════════════════════════════════════════════
function switchTab(tab) {
  ["shop", "gifts", "users"].forEach((t) => {
    document.getElementById(`tab-${t}`).classList.toggle("hidden", t !== tab);
  });
  document.querySelectorAll(".nav-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  const titles = { shop: "🎁 Gifts Shop", gifts: "🎁 Manage Gifts", users: "👥 Manage Users" };
  document.getElementById("page-title").textContent = titles[tab];

  if (tab === "gifts") loadAdminGifts();
  if (tab === "users") loadUsers();
  tg.HapticFeedback?.impactOccurred("light");
}

// ══════════════════════════════════════════════════════════════
// SHOP CATALOG
// ══════════════════════════════════════════════════════════════
async function loadGifts() {
  const res = await fetch(`${API_BASE}/api/gifts`, { headers: authHeaders() });
  if (!res.ok) { showError("Could not load gifts."); return; }
  const data = await res.json();
  renderGifts(data.gifts);
}

function renderGifts(gifts) {
  animInstances.forEach((a) => a.destroy());
  animInstances = [];

  const grid = document.getElementById("gift-grid");
  grid.innerHTML = "";

  if (!gifts.length) {
    grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;color:#888;">No gifts yet.</p>`;
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
      const anim = lottie.loadAnimation({
        container: animBox, renderer: "svg", loop: true, autoplay: true, path: gift.animation_url,
      });
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

function openViewer(gift) {
  currentGift = gift;
  const box = document.getElementById("viewer-anim");
  box.innerHTML = "";
  document.getElementById("viewer-name").textContent = `${gift.emoji || "🎁"} ${gift.name}`;
  document.getElementById("viewer-price").textContent = gift.price > 0 ? `${gift.price} ⭐` : "";
  document.getElementById("buy-status").textContent = "";
  document.getElementById("buy-comment").value = "";
  backToChoice();

  const canBuy = currentUser && currentUser.role !== "owner" && currentUser.role !== "admin" && gift.price > 0;
  document.getElementById("buy-step-choice").classList.toggle("hidden", !canBuy);
  if (!canBuy && (currentUser.role === "owner" || currentUser.role === "admin")) {
    document.getElementById("buy-status").textContent = "Staff accounts can preview gifts but not purchase.";
    document.getElementById("buy-status").style.color = "#888";
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
  currentGift = null;
}

function startBuy(forOther) {
  buyForOther = forOther;
  document.getElementById("buy-step-choice").classList.add("hidden");
  document.getElementById("buy-step-comment").classList.remove("hidden");
}

function backToChoice() {
  document.getElementById("buy-step-comment").classList.add("hidden");
  document.getElementById("buy-step-choice").classList.remove("hidden");
}

async function confirmBuy() {
  const status = document.getElementById("buy-status");
  status.style.color = "#ff8a8a";
  status.textContent = "Creating invoice…";

  const comment = document.getElementById("buy-comment").value.trim();

  const res = await fetch(`${API_BASE}/api/buy`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ gift_db_id: currentGift.id, for_other: buyForOther, comment_text: comment }),
  });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    status.textContent = e.detail || "Could not create order.";
    return;
  }

  const data = await res.json();
  status.style.color = "#8aff9e";
  status.textContent = "Opening payment…";

  tg.openInvoice(data.invoice_link, (paymentStatus) => {
    if (paymentStatus === "paid") {
      status.textContent = buyForOther
        ? "✅ Paid! Check your bot chat for the claim link."
        : "✅ Paid! Check your Telegram profile gifts.";
      tg.HapticFeedback?.notificationOccurred("success");
      setTimeout(() => { closeViewer(); loadGifts(); }, 1800);
    } else if (paymentStatus === "cancelled") {
      status.textContent = "Payment cancelled.";
    } else if (paymentStatus === "failed") {
      status.textContent = "Payment failed. Try again.";
    }
  });
}

// ══════════════════════════════════════════════════════════════
// ADMIN — GIFT MANAGEMENT
// ══════════════════════════════════════════════════════════════
async function loadAdminGifts() {
  const res = await fetch(`${API_BASE}/api/admin/gifts`, { headers: authHeaders() });
  if (!res.ok) return;
  const data = await res.json();
  renderAdminGifts(data.gifts);
}

function renderAdminGifts(gifts) {
  const list = document.getElementById("admin-gift-list");
  list.innerHTML = "";

  if (!gifts.length) {
    list.innerHTML = `<p style="text-align:center;color:#888;padding:20px 0;">No gifts yet. Tap "+ Add New Gift".</p>`;
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
      <div class="actions">
        <button class="pill-btn edit">Edit</button>
        ${g.active
          ? `<button class="pill-btn danger">Hide</button>`
          : `<button class="pill-btn success">Show</button>`}
      </div>
    `;
    row.querySelector(".edit").onclick = () => openGiftForm(g);
    const toggleBtn = row.querySelector(g.active ? ".danger" : ".success");
    toggleBtn.onclick = () => toggleGiftActive(g.id, g.active);

    if (currentUser.role === "owner") {
      const delBtn = document.createElement("button");
      delBtn.className = "pill-btn danger";
      delBtn.textContent = "Delete";
      delBtn.onclick = () => deleteGiftPermanently(g.id, g.name);
      row.querySelector(".actions").appendChild(delBtn);
    }

    list.appendChild(row);
  });
}

function deleteGiftPermanently(gid, name) {
  const doDelete = async () => {
    const res = await fetch(`${API_BASE}/api/admin/gift/${gid}/hard-delete`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (res.ok) loadAdminGifts();
  };

  if (tg.showConfirm) {
    tg.showConfirm(`Permanently delete "${name}"? This cannot be undone.`, (ok) => {
      if (ok) doDelete();
    });
  } else if (confirm(`Permanently delete "${name}"? This cannot be undone.`)) {
    doDelete();
  }
}

async function toggleGiftActive(gid, isActive) {
  const path = isActive ? `gift/${gid}` : `gift/${gid}/reactivate`;
  const method = isActive ? "DELETE" : "POST";
  const res = await fetch(`${API_BASE}/api/admin/${path}`, { method, headers: authHeaders() });
  if (res.ok) loadAdminGifts();
}

function openGiftForm(gift = null) {
  editingGiftId = gift ? gift.id : null;
  document.getElementById("gift-modal-title").textContent = gift ? "Edit Gift" : "Add New Gift";
  document.getElementById("gift-submit-btn").textContent = gift ? "Save" : "Upload";
  document.getElementById("f-name").value = gift ? gift.name : "";
  document.getElementById("f-giftid").value = gift ? gift.gift_id : "";
  document.getElementById("f-emoji").value = gift ? gift.emoji : "🎁";
  document.getElementById("f-player-price").value = gift ? gift.player_price : "";
  document.getElementById("f-reseller-price").value = gift ? gift.reseller_price : "";
  document.getElementById("f-giftid").disabled = !!gift; // gift_id immutable once created
  document.getElementById("file-label-note").textContent = gift ? "(leave empty to keep current)" : "";
  document.getElementById("f-file").value = "";
  document.getElementById("preview-box").classList.add("hidden");
  document.getElementById("upload-status").textContent = "";
  document.getElementById("gift-modal").classList.remove("hidden");
}

function closeGiftForm() {
  document.getElementById("gift-modal").classList.add("hidden");
  if (previewAnim) { previewAnim.destroy(); previewAnim = null; }
}

document.getElementById("f-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  const box = document.getElementById("preview-box");
  if (!file) return;
  box.classList.remove("hidden");
  box.innerHTML = "";
  if (previewAnim) previewAnim.destroy();
  try {
    const json = JSON.parse(await file.text());
    previewAnim = lottie.loadAnimation({ container: box, renderer: "svg", loop: true, autoplay: true, animationData: json });
  } catch {
    box.innerHTML = `<span style="color:#ff8a8a;font-size:12px;">Invalid JSON file</span>`;
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

  if (!name || !giftId || !playerPrice || !resellerPrice || (!isEdit && !file)) {
    status.textContent = "Fill in all fields" + (isEdit ? "." : " and select a file.");
    return;
  }

  status.textContent = isEdit ? "Saving…" : "Uploading…";

  const form = new FormData();
  form.append("name", name);
  form.append("emoji", emoji);
  form.append("player_price", playerPrice);
  form.append("reseller_price", resellerPrice);
  if (!isEdit) form.append("gift_id", giftId);
  if (file) form.append("animation", file);

  const url = isEdit ? `${API_BASE}/api/admin/gift/${editingGiftId}` : `${API_BASE}/api/admin/gift`;
  const method = isEdit ? "PATCH" : "POST";

  const res = await fetch(url, { method, headers: authHeaders(), body: form });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    status.textContent = e.detail || "Failed.";
    return;
  }

  status.textContent = isEdit ? "✅ Saved!" : "✅ Gift added!";
  setTimeout(() => {
    closeGiftForm();
    loadAdminGifts();
    loadGifts();
  }, 600);
}

// ══════════════════════════════════════════════════════════════
// ADMIN — USER MANAGEMENT
// ══════════════════════════════════════════════════════════════
let allUsers = [];

async function loadUsers() {
  const res = await fetch(`${API_BASE}/api/admin/users`, { headers: authHeaders() });
  if (!res.ok) return;
  const data = await res.json();
  allUsers = data.users;
  renderUsers(allUsers);
}

function filterUsers() {
  const q = document.getElementById("user-search").value.trim().toLowerCase().replace(/^@/, "");
  if (!q) { renderUsers(allUsers); return; }
  const filtered = allUsers.filter((u) => {
    const idMatch = String(u.user_id).includes(q);
    const nameMatch = (u.username || "").toLowerCase().includes(q);
    const firstMatch = (u.first_name || "").toLowerCase().includes(q);
    return idMatch || nameMatch || firstMatch;
  });
  renderUsers(filtered);
}

const ROLE_ORDER = ["user", "reseller", "admin", "owner"];
const ROLE_LABELS = { user: "👤 Users", reseller: "🏪 Resellers", admin: "🛠️ Admins", owner: "👑 Owner" };

function renderUsers(users) {
  const list = document.getElementById("user-list");
  list.innerHTML = "";

  if (!users.length) {
    list.innerHTML = `<p style="text-align:center;color:#888;padding:20px 0;">No users found.</p>`;
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
        <span style="color:#ffd75e;">${u.balance || 0} ⭐</span>
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

    const balBtn = document.createElement("button");
    balBtn.className = "pill-btn neutral";
    balBtn.textContent = "💰";
    balBtn.onclick = () => openBalanceModal(u);
    actions.appendChild(balBtn);

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
  const res = await fetch(`${API_BASE}/api/admin/users/${uid}/${path}`, { method: "POST", headers: authHeaders() });
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

function closeRoleModal() {
  document.getElementById("role-modal").classList.add("hidden");
}

async function setRole(role) {
  const res = await fetch(`${API_BASE}/api/admin/users/${roleTargetUid}/role`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ role }),
  });
  if (res.ok) {
    closeRoleModal();
    await loadUsers();
    filterUsers();
  }
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
  let selectedRole = "reseller";
  roles.forEach((r) => {
    const btn = document.createElement("button");
    btn.className = "role-option-btn" + (r === selectedRole ? " current" : "");
    btn.textContent = r.charAt(0).toUpperCase() + r.slice(1);
    btn.onclick = () => {
      selectedRole = r;
      opts.querySelectorAll(".role-option-btn").forEach((b) => b.classList.remove("current"));
      btn.classList.add("current");
    };
    btn.dataset.role = r;
    opts.appendChild(btn);
  });
  opts.dataset.selected = selectedRole;
  document.getElementById("add-user-modal").classList.remove("hidden");
}

function closeAddUserForm() {
  document.getElementById("add-user-modal").classList.add("hidden");
}

async function submitAddUser() {
  const uid = document.getElementById("au-userid").value.trim();
  const status = document.getElementById("add-user-status");
  const selected = document.querySelector("#au-role-options .role-option-btn.current");
  const role = selected ? selected.dataset.role : "reseller";

  if (!uid) { status.textContent = "Enter a Telegram user ID."; return; }

  status.textContent = "Adding…";
  const res = await fetch(`${API_BASE}/api/admin/users`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ user_id: Number(uid), role }),
  });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    status.textContent = e.detail || "Failed to add user.";
    return;
  }

  status.textContent = "✅ Added!";
  setTimeout(() => { closeAddUserForm(); loadUsers(); }, 500);
}

// ══════════════════════════════════════════════════════════════
// BALANCE ADJUSTMENT
// ══════════════════════════════════════════════════════════════
let balanceTargetUid = null;

function openBalanceModal(u) {
  balanceTargetUid = u.user_id;
  document.getElementById("balance-target-name").textContent = u.username ? `@${u.username}` : (u.first_name || `#${u.user_id}`);
  document.getElementById("balance-current").textContent = `Current: ${u.balance || 0} ⭐`;
  document.getElementById("bal-amount").value = "";
  document.getElementById("balance-status").textContent = "";
  document.getElementById("balance-modal").classList.remove("hidden");
}

function closeBalanceModal() {
  document.getElementById("balance-modal").classList.add("hidden");
}

async function submitBalance() {
  const amount = document.getElementById("bal-amount").value;
  const status = document.getElementById("balance-status");
  if (!amount) { status.textContent = "Enter an amount."; return; }

  const res = await fetch(`${API_BASE}/api/admin/users/${balanceTargetUid}/balance`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ amount: Number(amount) }),
  });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    status.textContent = e.detail || "Failed.";
    return;
  }

  status.textContent = "✅ Updated!";
  setTimeout(async () => { closeBalanceModal(); await loadUsers(); filterUsers(); }, 500);
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
authenticate();
