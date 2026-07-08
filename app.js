// ══════════════════════════════════════════════════════════════
// CONFIG — point this at your justrunmy.app API subdomain
// ══════════════════════════════════════════════════════════════
const API_BASE = "https://gifts-bot-9e9.h.jrnm.app";

const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

let currentUser = null;
let animInstances = []; // track lottie instances so we can destroy on re-render

// ══════════════════════════════════════════════════════════════
// AUTH — runs once on load
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
  if (!res.ok) {
    showError("Login failed. Please reopen the app.");
    return;
  }
  currentUser = await res.json();
  document.getElementById("role-badge").textContent = currentUser.role;
  if (currentUser.role === "owner" || currentUser.role === "admin") {
    document.getElementById("admin-btn").classList.remove("hidden");
  }
  await loadGifts();
}

function showError(msg) {
  document.getElementById("loading").classList.add("hidden");
  document.getElementById("error-text").textContent = msg;
  document.getElementById("error").classList.remove("hidden");
}

// ══════════════════════════════════════════════════════════════
// CATALOG
// ══════════════════════════════════════════════════════════════
async function loadGifts() {
  const res = await fetch(`${API_BASE}/api/gifts`, {
    headers: { "X-Telegram-Init-Data": tg.initData },
  });
  if (!res.ok) {
    showError("Could not load gifts.");
    return;
  }
  const data = await res.json();
  renderGifts(data.gifts);

  document.getElementById("loading").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
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
        container: animBox,
        renderer: "svg",
        loop: true,
        autoplay: true,
        path: gift.animation_url,
      });
      animInstances.push(anim);
    }
  });
}

// ══════════════════════════════════════════════════════════════
// FULLSCREEN VIEWER
// ══════════════════════════════════════════════════════════════
let viewerAnim = null;

function openViewer(url) {
  if (!url) return;
  const modal = document.getElementById("viewer-modal");
  const box = document.getElementById("viewer-anim");
  box.innerHTML = "";
  modal.classList.remove("hidden");
  viewerAnim = lottie.loadAnimation({
    container: box,
    renderer: "svg",
    loop: true,
    autoplay: true,
    path: url,
  });
  tg.HapticFeedback?.impactOccurred("light");
}

function closeViewer() {
  document.getElementById("viewer-modal").classList.add("hidden");
  if (viewerAnim) { viewerAnim.destroy(); viewerAnim = null; }
}

// ══════════════════════════════════════════════════════════════
// OWNER/ADMIN — upload new gift
// ══════════════════════════════════════════════════════════════
let previewAnim = null;

function openUpload() {
  document.getElementById("upload-modal").classList.remove("hidden");
}

function closeUpload() {
  document.getElementById("upload-modal").classList.add("hidden");
  document.getElementById("upload-status").textContent = "";
}

document.getElementById("f-file")?.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  const box = document.getElementById("preview-box");
  if (!file) return;
  box.classList.remove("hidden");
  box.innerHTML = "";
  if (previewAnim) previewAnim.destroy();
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    previewAnim = lottie.loadAnimation({
      container: box,
      renderer: "svg",
      loop: true,
      autoplay: true,
      animationData: json,
    });
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

  if (!name || !giftId || !playerPrice || !resellerPrice || !file) {
    status.textContent = "Fill in all fields and select a file.";
    return;
  }

  status.textContent = "Uploading…";

  const form = new FormData();
  form.append("name", name);
  form.append("gift_id", giftId);
  form.append("emoji", emoji);
  form.append("player_price", playerPrice);
  form.append("reseller_price", resellerPrice);
  form.append("animation", file);

  const res = await fetch(`${API_BASE}/api/admin/gift`, {
    method: "POST",
    headers: { "X-Telegram-Init-Data": tg.initData },
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    status.textContent = err.detail || "Upload failed.";
    return;
  }

  status.textContent = "✅ Gift added!";
  setTimeout(() => {
    closeUpload();
    loadGifts();
  }, 700);
}

// ══════════════════════════════════════════════════════════════
authenticate();
