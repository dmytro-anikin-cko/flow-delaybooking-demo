# Flow + seat reservation before payment (demo)

Proof of concept for a ferry OTA that doesn't want to hold customer funds before ticket availability is confirmed. The seats are checked/reserved with the operator **after the shopper enters their payment details but before any payment request is sent to Checkout.com**. If the seats are gone, the payment is never created.

Uses the Checkout.com **sandbox** and [Flow](https://www.checkout.com/docs/payments/accept-payments/accept-a-payment-on-your-website/flow) (`CheckoutWebComponents`).

## What it shows

- A fixed booking summary (one ferry ticket, €100.00) with Flow and a custom Pay button (`showPayButton: false`).
- Seat reservation (simulated operator call, 10 s delay) inside Flow's `onTokenized` (cards) and `onAuthorized` (wallets) callbacks. Returning `{ continue: false }` aborts before any payment request.
- A server-side safety net: `/api/submit-payment-session` refuses (403) to call Checkout.com unless the payment session has a reservation, so the client-side check can't be bypassed.
- A "Simulate seats unavailable" checkbox (top right) to test the sold-out path.

## Setup

```bash
npm install
cp .env.example .env   # then fill in your sandbox keys
npm start
```

Open http://localhost:3000.

`.env`:

| Variable | Description |
| --- | --- |
| `CKO_SECRET_KEY` | Sandbox secret key (server only) |
| `CKO_PUBLIC_KEY` | Sandbox public key (served to the client via `GET /api/config`) |
| `CKO_PROCESSING_CHANNEL_ID` | Processing channel ID |

## How to test

- **Happy path:** enter a sandbox test card (e.g. `4242 4242 4242 4242`, any future expiry, any CVV), click Pay. A "Confirming…" overlay shows for ~10 s while seats are reserved, then the payment goes through and the button shows "Payment Complete ✅".
- **Sold-out path:** tick "Simulate seats unavailable" and pay. After ~10 s the overlay closes, Flow shows "Sorry, these seats are no longer available." and **no payment is created**.
- **Server-side guard:** `POST /api/submit-payment-session` with a session ID that was never reserved returns `403` without calling Checkout.com.
- **Wallets:** Google Pay / Apple Pay appear in Flow if available for your browser/device and sandbox account.

## Event order & gotchas

Based on reading the Flow SDK bundle and testing:

- **Cards:** `submit()` → validity check → `onSubmit` (not awaited) → tokenization → `onTokenized` (awaited) → Flow applies `{ continue: false }` as an abort before any payment request → `handleSubmit` → backend submit.
- **Google Pay:** button click → wallet sheet → `onAuthorized` (awaited; the Google Pay sheet is already closed at this point) → THEN `submit()` fires `onSubmit` → `onTokenized` fires without being awaited and its return value is ignored → abort check → `handleSubmit`.
- So `onSubmit` can fire **after** an abort on wallets. A UI that treats `onSubmit` as "payment is going ahead" would re-show the overlay and leave it stuck. This is why the `submissionAborted` flag exists.
- Wallets are gated only by `onAuthorized`; `{ continue: false }` from `onTokenized` does not stop a wallet payment.
- Apple Pay behaviour (whether the sheet stays open during `onAuthorized`, and its session timeout) was not verified; test before relying on a long reservation.
- Reservations here are in-memory, never expire, and are never released. A real integration needs a reservation TTL, release on payment failure/abandonment, and tying the reservation to the order and amount.
- `{ continue: false }` is the supported abort in Flow; `handleSubmit` has no supported abort and must return the unmodified submit response.

## Production TODOs

- **3DS is disabled** (`3ds: { enabled: false }`) to keep the demo simple. Enable it in production.
- Real operator integration, reservation expiry/release, and amount/order validation (see above).
