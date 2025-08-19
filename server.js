// Frusette Backend Starter (Express + Render + Interakt + Resend)
// example structure (this WILL vary):
// phoneNumber: whatsapp, // "+91..."
// campaignName: "frusette_support_ticket",
// templateName: "support_alert",
// languageCode: "en",
// headerValues: [],
// bodyValues: [id],
// sender: INTERAKT_SENDER_ID,
};
const w = await fetch(INTERAKT_API_URL, {
method: "POST",
headers: {
Authorization: `Bearer ${INTERAKT_API_KEY}`,
"Content-Type": "application/json",
},
body: JSON.stringify(waPayload),
});
if (!w.ok) throw new Error("interakt_fail:" + w.status);
out.whatsapp = "sent";
}


res.json(out);
} catch (e) {
console.error("/support/notify error", e);
// best-effort result
res.status(200).json(out);
}
});


// (Optional) list recent tickets for debugging
app.get("/debug/tickets", (req, res) => {
res.json({ count: STORE.tickets.length, tickets: STORE.tickets.slice(-50) });
});


app.listen(PORT, () => {
console.log(`[frusette-backend] listening on :${PORT}`);
});
