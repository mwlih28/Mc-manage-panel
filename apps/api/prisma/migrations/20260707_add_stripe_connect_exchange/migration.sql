-- Escrow for the Stripe Connect OAuth relay hop. Only ever populated/read on
-- the Kretase project's own canonical deployment (the one with
-- STRIPE_CONNECT_PLATFORM_SECRET_KEY set) — every other self-hosted install
-- ships this table unused since their relay routes 404 without that secret.
CREATE TABLE "StripeConnectExchange" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "stripeUserId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "publishableKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StripeConnectExchange_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StripeConnectExchange_code_key" ON "StripeConnectExchange"("code");
