# Security Policy

## Security model

LP Sentinel is a local-first, read-only monitoring application. It does not request, read, transmit, or persist wallet private keys or seed phrases. Any liquidity-removal transaction must be reviewed and explicitly approved in the user's browser wallet.

User-added LP base records are stored in the current browser's IndexedDB. Local service settings and notification status remain in `data/lp-sentinel.json`. Runtime data files, `.env` files, dependencies, and build output are excluded from Git. RPC credentials and `BSCSCAN_API_KEY` must only be supplied through server-side environment variables.

Variables prefixed with `VITE_` are embedded in browser assets at build time and must never contain private credentials. `VITE_BSC_RPC_URL` should only contain a public RPC URL.

Vercel DingTalk delivery requires `DINGTALK_APP_KEY`, `DINGTALK_APP_SECRET`, `DINGTALK_ROBOT_CODE`, and `DINGTALK_USER_IDS` as encrypted server-side environment variables. They must never use a `VITE_` prefix and are never returned by the API. The short-lived DingTalk access token is cached only in Function memory.

Because the deployment can be publicly reachable, notification refresh and test requests are protected by `LP_SENTINEL_MONITOR_TOKEN`, which must be a separate random value of at least 32 characters. The browser keeps this value in `sessionStorage` for the current session and sends it only as an HTTPS bearer token. Do not reuse a wallet secret, DingTalk AppSecret, password, or API key for this token.

The Vercel deployment does not silently upload IndexedDB LP records to persistent cloud storage. Records are sent only to same-origin API calls needed to hydrate and refresh the current Function request. Closing the page stops browser-driven cloud monitoring.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's **Security** tab using a private vulnerability report. Do not open a public issue containing exploit details, credentials, wallet identifiers, or other sensitive information.

Include the affected version or commit, reproduction steps, impact, and any suggested mitigation. Do not test against wallets or funds you do not own, and do not broadcast transactions while reproducing an issue.

## Supported version

Security fixes are applied to the latest commit on the `main` branch.
