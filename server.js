// server.js
import express from "express";
import cors from "cors";

// --- Config (env) ---
const PORT = process.env.PORT || 3000;
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM = process.env.RESEND_FROM || "onboarding@resend.dev";

// In-memory store (ephemeral)
const TICKETS = []; // [{id, created_at, ...incoming payload...}]

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Utils
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const pre = (s) => esc(s).replace(/\r?\n/g, "<br/>");

const money = (n) =>
  typeof n === "number"
    ? n.toLocaleString("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      })
    : "";

const rndId = () =>
  "SUP" + Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0");

// ---- Health
app.get("/health", (req, res) => res.json({ ok: true }));

// ---- Create ticket
app.post("/support", (req, res) => {
  const body = req.body || {};
  const id = rndId();
  const t = {
    id,
    created_at: new Date().toISOString(),
    ...body,
  };
  TICKETS.unshift(t);
  res.json({ ok: true, id });
});

// ---- Notify (email + optional WhatsApp later)
app.post("/support/notify", async (req, res) => {
  try {
    const { id, email } = req.body || {};
    const t = TICKETS.find((x) => x.id === id);
    if (!t) return res.status(404).json({ ok: false, error: "not_found" });

    // Compose HTML
    const isHelp =
      t.type === "manual_support" || String(t.reason).toLowerCase() === "help";

    const cartRows =
      (t.cart?.items || []).length > 0
        ? t.cart.items
            .map(
              (i) => `
              <tr>
                <td style="padding:4px 8px;border:1px solid #e5e7eb">${esc(
                  i.name
                )}</td>
                <td style="padding:4px 8px;border:1px solid #e5e7eb">${
                  i.qty ?? ""
                }</td>
                <td style="padding:4px 8px;border:1px solid #e5e7eb">${money(
                  i.price
                )}</td>
                <td style="padding:4px 8px;border:1px solid #e5e7eb">${money(
                  i.amount
                )}</td>
              </tr>`
            )
            .join("")
        : `<tr><td colspan="4" style="padding:6px 8px;border:1px solid #e5e7eb;color:#6b7280">No items</td></tr>`;

    const helpBlock = isHelp
      ? `
        <h3 style="margin:16px 0 8px">Issue</h3>
        <div style="font-size:14px;color:#111827">
          <div><b>Topic:</b> ${esc(t.help?.topic || "")}</div>
          <div><b>Order ID:</b> ${esc(t.help?.order_id || "")}</div>
          <div style="margin-top:4px"><b>Message:</b></div>
          <div style="margin-top:2px;background:#f9fafb;border:1px solid #e5e7eb;padding:8px;border-radius:6px">
            ${pre(t.help?.message || "")}
          </div>
        </div>
      `
      : "";

    const locationBlock = !isHelp
      ? `
        <div><b>Distance:</b> ${t.distance_km ?? ""} km</div>
        <div><b>Max:</b> ${t.max_km ?? ""} km</div>
        <div><b>Pincode:</b> ${esc(t.pincode ?? "")}</div>
      `
      : "";

    const address = t.customer?.address || {};
    const html = `
      <div style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#111827">
        <h2 style="margin:0 0 12px">[Frusette] Support ticket ${esc(t.id)}</h2>

        <div style="margin-bottom:8px">
          <div><b>Reason:</b> ${esc(t.reason || (isHelp ? "help" : ""))}</div>
          ${locationBlock}
        </div>

        ${isHelp ? helpBlock : ""}

        <h3 style="margin:16px 0 8px">Customer</h3>
        <div><b>Name:</b> ${esc(t.customer?.name || "")}</div>
        <div><b>WhatsApp:</b> ${esc(t.customer?.whatsapp || "")}</div>
        <div><b>Contact:</b> ${esc(t.customer?.contact || "")}</div>

        <h3 style="margin:16px 0 8px">Address</h3>
        <div>${esc(address.line1 || "")}</div>
        ${address.line2 ? `<div>${esc(address.line2)}</div>` : ""}
        ${address.landmark ? `<div>Landmark: ${esc(address.landmark)}</div>` : ""}
        <div>${esc(address.city || "")} ${address.address_type ? `(${esc(address.address_type)})` : ""}</div>

        <h3 style="margin:16px 0 8px">Cart</h3>
        <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:13px">
          <thead>
            <tr>
              <th style="text-align:left;padding:4px 8px;border:1px solid #e5e7eb">Item</th>
              <th style="text-align:left;padding:4px 8px;border:1px solid #e5e7eb">Qty</th>
              <th style="text-align:left;padding:4px 8px;border:1px solid #e5e7eb">Price</th>
              <th style="text-align:left;padding:4px 8px;border:1px solid #e5e7eb">Amount</th>
            </tr>
          </thead>
          <tbody>${cartRows}</tbody>
        </table>

        <div style="margin-top:8px">
          <div><b>Subtotal:</b> ${money(t.cart?.subtotal)}</div>
          <div><b>Discount:</b> ${money(t.cart?.discount)}</div>
          <div><b>Payable:</b> ${money(t.cart?.payable)}</div>
        </div>

        <div style="margin-top:12px">
          <a href="https://frusette-backend.onrender.com/debug/tickets" target="_blank" rel="noreferrer">View JSON</a>
        </div>
      </div>
    `;

    // Send email via Resend REST API
    if (email && RESEND_API_KEY) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: RESEND_FROM,
          to: [email],
          subject: `[Frusette] Support ticket ${t.id}`,
          html,
        }),
      });
    }

    res.json({ ok: true, id: t.id, emailed: Boolean(email) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "notify_failed" });
  }
});

// ---- Debug view
app.get("/debug/tickets", (req, res) => {
  res.json({ count: TICKETS.length, tickets: TICKETS });
});

app.listen(PORT, () =>
  console.log(`Frusette backend listening on :${PORT}`)
);
