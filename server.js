// server.js
// Frusette Backend (Express + Render + Interakt + Resend)

import express from "express";
import cors from "cors";
import fetch from "node-fetch";

// -------- ENV CONFIG --------
const PORT = process.env.PORT || 3000;
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM    = process.env.RESEND_FROM    || "no-reply@yourdomain.tld";
const INTERAKT_API_URL   = process.env.INTERAKT_API_URL  || "";
const INTERAKT_API_KEY   = process.env.INTERAKT_API_KEY  || "";
const INTERAKT_SENDER_ID = process.env.INTERAKT_SENDER_ID|| "";

// -------- APP --------
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const STORE = { tickets: [] };

// Helpers
function ticketId(prefix = "SUP") {
  return prefix + Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0");
}
function isSupportTicketLike(p) {
  return p && typeof p === "object" && (p.type === "out_of_zone" || p.type === "manual_support");
}

// Routes
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "frusette-backend", time: new Date().toISOString() });
});

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

app.post("/support/notify", async (req, res) => {
  const { id, email, whatsapp } = req.body || {};
  const out = { id, email: "skipped", whatsapp: "skipped" };
  try {
    // Email via Resend
    if (RESEND_API_KEY && email) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: RESEND_FROM,
          to: email,
          subject: `[Frusette] Support ticket ${id}`,
          html: `<p>New support ticket created.</p><p>ID: <b>${id}</b></p>`
        })
      });
      if (!r.ok) throw new Error("resend_fail:" + r.status);
      out.email = "sent";
    }

    // WhatsApp via Interakt (fill with your exact template payload when ready)
    if (INTERAKT_API_URL && INTERAKT_API_KEY && whatsapp) {
      const waPayload = {
        // phoneNumber: whatsapp,
        // templateName: "support_alert",
        // languageCode: "en",
        // bodyValues: [id],
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

app.get("/debug/tickets", (_req, res) => {
  res.json({ count: STORE.tickets.length, tickets: STORE.tickets.slice(-50) });
});

app.listen(PORT, () => {
  console.log(`[frusette-backend] listening on :${PORT}`);
});
