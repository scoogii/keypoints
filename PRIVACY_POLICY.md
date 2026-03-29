# Privacy Policy — Sift (Amazon Review Analyzer)

**Last updated:** March 29, 2026

## Overview

Sift ("the Extension") is a Chrome extension that analyzes Amazon product reviews using AI. This privacy policy explains what data we collect, how we use it, and your rights.

## Data We Collect

### Information you provide
- **Email address and name**: Collected when you sign in with Google. Used solely for account authentication and subscription management.

### Information collected automatically
- **IP address**: Used for rate limiting free-tier analyses (5 per day). Not stored permanently or linked to your identity.
- **Analysis logs**: We log timestamps of analyses for rate limiting purposes. These logs contain your IP address and, if signed in, your user ID.

### Information we do NOT collect
- We do not collect browsing history, purchase history, or any Amazon account information.
- We do not track your activity across websites.
- We do not access any data beyond the Amazon product page you choose to analyze.

## How We Use Your Data

| Data | Purpose |
|------|---------|
| Email & name | Account authentication, subscription management |
| IP address | Rate limiting (free tier) |
| Analysis logs | Enforcing daily analysis limits |
| Product reviews | Sent to Google Gemini AI for analysis, not stored on our servers |

## Third-Party Services

We use the following third-party services:

- **Google OAuth**: For authentication. Subject to [Google's Privacy Policy](https://policies.google.com/privacy).
- **Google Gemini AI**: Product reviews are sent to Google's Gemini API for analysis. Reviews are processed in real-time and are not stored by us. Subject to [Google's AI Terms](https://ai.google.dev/terms).
- **Stripe**: For payment processing. Payment information is handled entirely by Stripe and never touches our servers. Subject to [Stripe's Privacy Policy](https://stripe.com/privacy).

## Data Storage

- Account data (email, name, subscription status) is stored in a secured PostgreSQL database.
- Analysis results are cached locally in your browser using Chrome's storage API and are never sent to our servers.
- Chat messages are stored locally in your browser only.

## Data Retention

- Account data is retained as long as your account exists.
- Analysis rate-limiting logs are automatically cleared after 24 hours.
- Local cached data can be cleared at any time by removing the extension.

## Data Sharing

We do **not** sell, trade, or share your personal data with third parties, except as required to provide the service (authentication via Google, payments via Stripe, AI analysis via Google Gemini).

## Your Rights

You can:
- **Delete your account**: Contact us to request account deletion.
- **Clear local data**: Remove the extension to delete all locally cached data.
- **Opt out**: Use the extension without signing in (free tier, no personal data collected beyond IP for rate limiting).

## Security

We use industry-standard security measures including HTTPS encryption, secure JWT authentication, and restricted CORS policies.

## Children's Privacy

Sift is not intended for use by children under 13. We do not knowingly collect personal data from children.

## Changes to This Policy

We may update this privacy policy from time to time. Changes will be reflected by updating the "Last updated" date above.

## Contact

If you have questions about this privacy policy, please contact us at: **christian.nguyen6@hotmail.com**
