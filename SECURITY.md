# Security Policy

## Reporting a vulnerability

This project handles payments and customer addresses, so please do **not** open a public issue for a security problem.

Report it through [GitHub's private vulnerability reporting](https://github.com/tuhuateng/nanocheckout/security/advisories/new) instead. We aim to acknowledge a report within 5 business days.

Please include what you can: the affected file or endpoint, the conditions needed to reproduce it, and what an attacker gains. A proof of concept helps but is not required.

Do not test against a store that is not yours. Run it locally — `npm install && npm run dev` needs no credentials.

## Scope

In scope:

- Bypassing admin authentication or the session cookie signature
- Reading or decrypting buyer PII without an admin session
- Forging a Stripe webhook that changes an order's status
- Manipulating the price, shipping fee, or inventory from a client
- Escaping the redaction on the MCP endpoint, or reaching it without a valid token
- Injection through any request field that reaches SQL or the CSV export

Out of scope:

- The demo password `nano-demo-2026`, which is documented and only ever enabled when `ADMIN_PASSWORD_HASH` is unset in local development
- Anything requiring an already-compromised `CHECKOUT_PII_KEY`, `ADMIN_SESSION_SECRET`, or `MCP_TOKEN`
- Missing rate limiting on order creation, which the README asks you to add at the edge
- Vulnerabilities in Stripe, Cloudflare, or Postgres themselves

## What this project does on your behalf

Understanding these boundaries helps when judging a finding.

- Card details are handled only by Stripe Hosted Checkout and never reach this API.
- Buyer PII is encrypted at rest with AES-256-GCM; the email lookup value is HMAC-SHA256.
- Prices, shipping fees and stock are computed server-side; amounts sent by a client are ignored.
- Stripe webhooks are verified with the raw body, the signing secret, and a 5-minute timestamp tolerance.
- Admin sessions are signed HttpOnly `SameSite=Strict` cookies; the password is stored as a PBKDF2 hash.
- `externalUserId` is stored in plain text by design, so it can be looked up. Treat it as personal data.
