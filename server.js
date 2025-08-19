// server.js
// Frusette Backend (Express + Render + Interakt + Resend)
// Adds: GET /tickets/:id and rich HTML email with customer + cart details

import express from "express";
import cors from "cors";
import fetch from "node-fetch";

// -------- ENV CONFIG --------
const PORT = process.env.PORT || 3000;

// Email via Resend (optional)
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM    = process.env.RESEND_FROM    || "onboarding@resend.dev";

// WhatsApp via Interakt (optional — fill from Interakt docs)
const INTERAKT_API_URL   = process.env.INTERAKT_API_URL   || "";
const INTERAKT_API_KEY   = process.env.INTERAKT_API_KEY   || "";
const INTERAKT_SENDER_ID = process.env.INTERAKT_SENDER_ID || "";

// -------- APP --------
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// In-memory store (demo). Use a DB in production.
const STORE = { tickets: [] };

// Helpers
function ticketId(prefix = "SUP") {
  return prefix + Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0");
}
function isSupportTicketLike(p) {
  return p && typeof p === "object" && (p.type === "out_of_zone" || p.type === "manual_support");
}
const esc = s => String(s ?? "").replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

// -------- ROUTES --------
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "frusette-backend", time: new Date().toISOString() });
});

// Create/save a support ticket
app.post("/support", async (req, res) => {
  try {
    const payload = req.body || {};
    if (!isSupportTicketLike(payload)) return res.status(400).json({ error: "invalid_payload" });
    const id = payload.id || ticketId();
    const record = { id, created_at: new Date().toISOString(), ...payload };

    const idx = STORE.tickets.findIndex(t => t.id === id);
    if (idx >= 0) STORE.tickets[idx] = record; else STORE.tickets.push(record);

    res.json({ id, status: "created" });
  } catch (e) {
    console.error("[/support] error:", e);
    res.status(500).json({ error: "server_error" });
  }
});

// Send alerts (email + WhatsApp)
app.post("/support/notify", async (req, res) => {
  const { id, email, whatsapp } = req.body || {};
  const out = { id, email: "skipped", whatsapp: "skipped" };

  // Pull full ticket from memory so we can include details in the email
  const t = STORE.tickets.find(x => x.id === id) || {};
  const cust = t.customer || {};
  const addr = cust.address || {};
  const items = (t.cart?.items || []);

  // Build a clean HTML summary
  const rows = items.map(i =>
    `<tr><td>${esc(i.name)}</td><td align="right">${esc(i.qty)}</td><td align="right">${esc(i.price)}</td><td align="right">${esc(i.amount)}</td></tr>`
  ).join("");

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111">
      <h2>[Frusette] Support ticket ${esc(id || "(no id)")}</h2>
      <p><b>Reason:</b> ${esc(t.reason || t.type || "")} · <b>Distance:</b> ${esc(t.distance_km)} km · <b>Max:</b> ${esc(t.max_km)} km</p>
      <p><b>Pincode:</b> ${esc(t.pincode || "")}</p>
      <h3>Customer</h3>
      <p><b>Name:</b> ${esc(cust.name)}<br/>
         <b>WhatsApp:</b> ${esc(cust.whatsapp)}<br/>
         <b>Contact:</b> ${esc(cust.contact)}</p>
      <h3>Address</h3>
      <p>${esc(addr.line1)}<br/>
         ${esc(addr.line2)}<br/>
         ${addr.landmark ? `Landmark: ${esc(addr.landmark)}<br/>` : "" }
         ${esc(addr.city)} ${addr.address_type ? `(${esc(addr.address_type)})` : ""}</p>
      <h3>Cart</h3>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
        <tr><th align="left">Item</th><th>Qty</th><th>Price</th><th>Amount</th></tr>
        ${rows || "<tr><td colspan='4'>No items</td></tr>"}
      </table>
      <p style="margin-top:10px"><b>Subtotal:</b> ${esc(t.subtotal)} · <b>Discount:</b> ${esc(t.discount)} · <b>Payable:</b> ${esc(t.payable)}</p>
      ${id ? `<p><a href="https://frusette-backend.onrender.com/tickets/${esc(id)}">View JSON</a></p>` : ""}
    </div>
  `;

  try {
    // Email via Resend
    if (RESEND_API_KEY && email) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: RESEND_FROM, to: email, subject: `[Frusette] Support ticket ${id}`, html })
      });
      if (!r.ok) throw new Error("resend_fail:" + r.status);
      out.email = "sent";
    }

    // WhatsApp via Interakt (fill exact template when ready)
    if (INTERAKT_API_URL && INTERAKT_API_KEY && whatsapp) {
      const waPayload = {
        // phoneNumber: whatsapp,
        // templateName: "support_alert",
        // languageCode: "en",
        // bodyValues: [id, cust.name || "", t.pincode || ""],
        // sender: INTERAKT_SENDER_ID,
      };
      const w = await fetch(INTERAKT_API_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${INTERAKT_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(waPayload)
      });
      if (!w.ok) throw new Error("interakt_fail:" + w.status);
      out.whatsapp = "sent";
    }

    res.json(out);
  } catch (e) {
    console.error("[/support/notify] error:", e);
    res.status(200).json(out); // best-effort
  }
});

// Debug endpoints
app.get("/debug/tickets", (_req, res) => {
  res.json({ count: STORE.tickets.length, tickets: STORE.tickets.slice(-50) });
});

// NEW: get a single ticket by id
app.get("/tickets/:id", (req, res) => {
  const t = STORE.tickets.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: "not_found" });
  res.json(t);
});

app.listen(PORT, () => {
  console.log(`[frusette-backend] listening on :${PORT}`);
});
