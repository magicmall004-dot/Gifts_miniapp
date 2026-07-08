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
    card.onclick = () => openViewer(gift.animation_url);

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
// VIEWER
// ══════════════════════════════════════════════════════════════
let viewerAnim = null;

function openViewer(url) {
  if (!url) return;
  const modal = document.getElementById("viewer-modal");
  const box = document.getElementById("viewer-anim");
  box.innerHTML = "";
  modal.classList.remove("hidden");
  viewerAnim = lottie.loadAnimation({ container: box, renderer: "svg", loop: true, autoplay: true, path: url });
  tg.HapticFeedback?.impactOccurred("light");
}

function closeViewer() {
  document.getElementById("viewer-modal").classList.add("hidden");
  if (viewerAnim) { viewerAnim.destroy(); viewerAnim = null; }
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
    list.appendChild(row);
  });
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
async function loadUsers() {
  const res = await fetch(`${API_BASE}/api/admin/users`, { headers: authHeaders() });
  if (!res.ok) return;
  const data = await res.json();
  renderUsers(data.users);
}

function renderUsers(users) {
  const list = document.getElementById("user-list");
  list.innerHTML = "";

  users.forEach((u) => {
    const row = document.createElement("div");
    row.className = "list-row";
    const displayName = u.username ? `@${u.username}` : (u.first_name || `#${u.user_id}`);
    row.innerHTML = `
      <div class="thumb">👤</div>
      <div class="info">
        <div class="title">${escapeHtml(displayName)}</div>
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

    list.appendChild(row);
  });
}

async function toggleBan(uid, isBanned) {
  const path = isBanned ? "unban" : "ban";
  const res = await fetch(`${API_BASE}/api/admin/users/${uid}/${path}`, { method: "POST", headers: authHeaders() });
  if (res.ok) loadUsers();
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
    loadUsers();
  }
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
