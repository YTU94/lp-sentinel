# Security Policy

## Security model

LP Sentinel is a local-first, read-only monitoring application. It does not request, read, transmit, or persist wallet private keys or seed phrases. Any liquidity-removal transaction must be reviewed and explicitly approved in the user's browser wallet.

The application stores monitoring state locally in `data/lp-sentinel.json`. This file, `.env` files, dependencies, and build output are excluded from Git. RPC credentials and `BSCSCAN_API_KEY` must only be supplied through local environment variables.

Variables prefixed with `VITE_` are embedded in browser assets at build time and must never contain private credentials. `VITE_BSC_RPC_URL` should only contain a public RPC URL.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's **Security** tab using a private vulnerability report. Do not open a public issue containing exploit details, credentials, wallet identifiers, or other sensitive information.

Include the affected version or commit, reproduction steps, impact, and any suggested mitigation. Do not test against wallets or funds you do not own, and do not broadcast transactions while reproducing an issue.

## Supported version

Security fixes are applied to the latest commit on the `main` branch.
