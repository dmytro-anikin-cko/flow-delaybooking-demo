require("dotenv").config();
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const CKO_API = "https://api.sandbox.checkout.com";

const AMOUNT = 10000; // minor units (€100.00)
const CURRENCY = "EUR";
const RESERVATION_DELAY_MS = 10000; // fake operator availability check

// Payment session IDs whose seats have been reserved.
// Demo only: in-memory, never expires, never released.
const reservedSessions = new Set();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const ckoHeaders = () => ({
  Authorization: `Bearer ${process.env.CKO_SECRET_KEY}`,
  "Content-Type": "application/json",
});

// Only the public key is exposed to the client
app.get("/api/config", (req, res) => {
  res.json({ publicKey: process.env.CKO_PUBLIC_KEY });
});

app.post("/api/get-payment-session", async (req, res) => {
  try {
    const response = await fetch(`${CKO_API}/payment-sessions`, {
      method: "POST",
      headers: ckoHeaders(),
      body: JSON.stringify({
        amount: AMOUNT,
        currency: CURRENCY,
        // TODO (production): enable 3DS
        "3ds": { enabled: false },
        billing: { address: { country: "NL" } },
        enabled_payment_methods: ["card", "googlepay", "applepay"],
        items: [
          {
            reference: "FERRY-TICKET-1",
            name: "Ferry ticket",
            quantity: 1,
            unit_price: AMOUNT,
            total_amount: AMOUNT,
          },
        ],
        success_url: "https://example.com/success",
        failure_url: "https://example.com/failure",
        processing_channel_id: process.env.CKO_PROCESSING_CHANNEL_ID,
      }),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error("get-payment-session failed:", err);
    res.status(500).json({ error: "Failed to create payment session" });
  }
});

// Simulates the operator availability check
app.post("/api/reserve-seats", async (req, res) => {
  const { paymentSessionId, simulateSoldOut } = req.body || {};
  await new Promise((resolve) => setTimeout(resolve, RESERVATION_DELAY_MS));

  if (simulateSoldOut || !paymentSessionId) {
    return res.status(409).json({ reserved: false });
  }
  reservedSessions.add(paymentSessionId);
  res.json({ reserved: true });
});

app.post("/api/submit-payment-session", async (req, res) => {
  const { amount, session_data, paymentSessionId } = req.body || {};

  // Server-side safety net: never submit a payment without a reservation
  if (!paymentSessionId || !reservedSessions.has(paymentSessionId)) {
    return res
      .status(403)
      .json({ error: "Seats are not reserved for this payment session" });
  }

  try {
    const response = await fetch(
      `${CKO_API}/payment-sessions/${encodeURIComponent(paymentSessionId)}/submit`,
      {
        method: "POST",
        headers: ckoHeaders(),
        body: JSON.stringify({ amount, session_data }),
      }
    );
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error("submit-payment-session failed:", err);
    res.status(500).json({ error: "Failed to submit payment session" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
