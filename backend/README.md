# Backend

## Components

- `worker.js`: HTTP API gateway, authorization, request validation, rate limiting and streaming chat responses.
- `foundry-api.js`: server-side Entra authentication and hosted Foundry calls.
- `chat-api.js`, `chat-tools.js`: chat contracts, request-scoped evidence tools and optional legacy model-provider integration.
- `forecast-model.js`: reads frozen artifacts from `../stat_model/` and uses the shared pure frontend helpers for inference.
- `agents/`: separately deployed Foundry agents and orchestration service.
- `scripts/`: data preparation utilities. Raw downloads belong in ignored `backend/data/`.
- `tests/`: JavaScript integration, forecasting, evidence and replay tests.

## Gateway

From the repository root:

```sh
npm ci
cp backend/.dev.vars.example backend/.dev.vars
# Fill in credentials locally.
npm run dev
npm run deploy:check
# Explicit production deployment:
npm run deploy
```

`wrangler.jsonc` keeps the existing Worker name and references `../frontend/dist` as the public asset directory. Server secrets belong in Cloudflare Secrets in production. `.dev.vars`, Azure login state, virtual environments and deployment archives must not be committed.

## Foundry

See [agents/README.md](agents/README.md) for the four role resources and hosted orchestration service. Static frontend deployment does not redeploy these services. Numerical model inference runs in the gateway and browser; it is not currently an agent query tool.

## Azure App Service

`server.js` runs on Node.js 22 and serves the allow-listed `frontend/dist/` assets and API from the same origin. `static-assets.js` never serves the backend source or model files. `web-api.js` validates cross-origin access; no extra origins are enabled unless explicitly listed in `ALLOWED_WEB_ORIGINS`.

From the repository root, `npm run build` then `npm start` starts the website on port 8080 (or `PORT`). Configure `PUBLIC_ORIGIN` to the deployed HTTPS origin. Runtime credentials are `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET`, stored only in App Service application settings. `AI_BACKEND=foundry` and `FOUNDRY_ENDPOINT` select the existing hosted agent service. An optional `CHAT_ACCESS_TOKEN` enables a shared access code.

To prepare a minimal deployment directory, run `node backend/scripts/package-azure.mjs /absolute/path/to/a/new/staging-directory` after building. The destination must not already exist. It contains runtime files, compact public replay data and frozen model artifacts, excluding credentials, raw datasets, tests, virtual environments and development dependencies. Zip the directory contents and deploy with `az webapp deploy --type zip`. Azure runtime settings must select Node.js 22 LTS and the startup command `npm start`.

The in-memory request cap is per process, resets on restart and is not a strict global billing limit. A free App Service plan may have cold starts and daily usage limits.
