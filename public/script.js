const AMOUNT = 10000; // minor units (€100.00)

const payButton = document.getElementById("pay-button");
const overlay = document.getElementById("overlay");
const sessionIdEl = document.getElementById("session-id");
const soldOutToggle = document.getElementById("simulate-sold-out");
const threeDSToggle = document.getElementById("enable-3ds");

const PAY_LABEL = "Pay €100.00";

let paymentSessionId = null;
let component = null;
// Set when a reservation fails. Wallets fire onSubmit AFTER an abort,
// so onSubmit must not re-show the overlay in that case.
let submissionAborted = false;

function showOverlay() {
  overlay.classList.remove("hidden");
  overlay.classList.add("flex");
}

function hideOverlay() {
  overlay.classList.remove("flex");
  overlay.classList.add("hidden");
}

function resetPayButton() {
  payButton.textContent = PAY_LABEL;
  payButton.disabled = false;
}

// Simulated operator availability check (backend waits ~10s)
async function reserveSeats() {
  submissionAborted = false;
  showOverlay();
  try {
    const response = await fetch("/api/reserve-seats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paymentSessionId,
        simulateSoldOut: soldOutToggle.checked,
      }),
    });
    if (!response.ok) {
      console.log("Seat reservation failed, status:", response.status);
    }
    return response.ok;
  } catch (err) {
    console.error("Seat reservation request failed:", err);
    return false;
  }
}

function abortSubmission(errorMessage) {
  submissionAborted = true;
  hideOverlay();
  resetPayButton();
  return { continue: false, errorMessage };
}

async function reserveOrAbort() {
  const reserved = await reserveSeats();
  if (!reserved) {
    return abortSubmission("Sorry, these seats are no longer available.");
  }
  return { continue: true };
}

// (Re)creates the payment session and mounts Flow.
// Called on load and whenever the 3DS toggle changes (3DS is fixed per session).
async function setup() {
  threeDSToggle.disabled = true;
  if (component) {
    component.unmount();
    component = null;
  }
  document.getElementById("flow-container").innerHTML = "";
  paymentSessionId = null;
  submissionAborted = false;
  hideOverlay();
  resetPayButton();
  sessionIdEl.textContent = "loading…";

  const [{ publicKey }, session] = await Promise.all([
    fetch("/api/config").then((r) => r.json()),
    fetch("/api/get-payment-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threeDS: threeDSToggle.checked }),
    }).then((r) => r.json()),
  ]);

  if (!session.id) {
    sessionIdEl.textContent = "failed to create session";
    console.error("Payment session creation failed:", session);
    return;
  }
  paymentSessionId = session.id;
  sessionIdEl.textContent = paymentSessionId;

  const checkout = await CheckoutWebComponents({
    publicKey,
    environment: "sandbox",
    paymentSession: session,
    showPayButton: false,

    // Wallets (Apple Pay / Google Pay): gated here
    onAuthorized: async () => {
      console.log("onAuthorized");
      return reserveOrAbort();
    },

    // Cards: gated here
    onTokenized: async (tokenizeResult) => {
      console.log("onTokenized", tokenizeResult);
      if (tokenizeResult.type !== "card") return { continue: true };
      return reserveOrAbort();
    },

    onSubmit: () => {
      console.log("onSubmit");
      if (submissionAborted) return;
      showOverlay();
      payButton.textContent = "Processing...";
      payButton.disabled = true;
    },

    handleSubmit: async (flowComponent, submitData) => {
      const response = await fetch("/api/submit-payment-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: AMOUNT,
          session_data: submitData.session_data,
          paymentSessionId,
        }),
      });
      return response.json();
    },

    onPaymentCompleted: (_component, paymentResponse) => {
      console.log("onPaymentCompleted", paymentResponse);
      hideOverlay();
      payButton.textContent = "Payment Complete ✅";
      payButton.disabled = true;
    },

    onPaymentFailed: (_component, error) => {
      console.log("onPaymentFailed", error);
      hideOverlay();
      resetPayButton();
    },

    onError: (_component, error) => {
      console.error("onError", error);
      hideOverlay();
      resetPayButton();
    },
  });

  component = checkout.create("flow");
  if (await component.isAvailable()) {
    component.mount("#flow-container");
  }
}

function init() {
  return setup().finally(() => {
    threeDSToggle.disabled = false;
  });
}

threeDSToggle.addEventListener("change", () => {
  init().catch((err) => console.error("Init failed:", err));
});

payButton.addEventListener("click", () => {
  submissionAborted = false;
  if (component && component.isValid()) component.submit();
});

init().catch((err) => console.error("Init failed:", err));
