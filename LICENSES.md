# LICENSES

## VaaniResolve (this repository)
Intended as a hackathon/demo project by Ashish. No license file is asserted yet — treat as all-rights-reserved until the author licenses it. Contact the author for use permission.

## Third-party dependencies (installed via npm)
Each dependency is governed by its own license. The notable ones used directly:

| Package | License | Notes |
|---|---|---|
| `react`, `react-dom` | MIT | UI runtime |
| `vite`, `@vitejs/plugin-react` | MIT | build tooling |
| `tailwindcss`, `autoprefixer`, `postcss` | MIT | styling |
| `express`, `cors` | MIT | server |
| `ws` | MIT | WebSocket |
| `dotenv` | BSD-2-Clause | env loading |
| `@anthropic-ai/sdk` | MIT | LLM client |
| `tsx`, `typescript` | MIT / Apache-2.0 | dev tooling |

Full license texts live in the respective packages under `node_modules/<pkg>/LICENSE*`.

## Data
All customer/order/product data is **synthetic fiction**. Product names (Sony, Apple, Samsung, Nike, Amazon Kindle, ideal customer names) belong to their respective owners and are used solely to make the demo data realistic. No endorsement is claimed.

## Third-party services used at runtime
- **Rime** TTS — usage subject to Rime’s terms; requires a user-supplied key.
- **Anthropic** — optional LLM; requires a user-supplied key.
- **Google Web Speech API** — provided by the browser; no key required.