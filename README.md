# Twelfth Man

Football match replay, goal and shot forecasts, and conversations with four independent AI agents.

Website: [twelfth-man.azurewebsites.net](https://twelfth-man.azurewebsites.net/)

The existing statistical model is a separate contribution; its original Git history, documentation and files are preserved under `stat_model/`.

## Project layout

```text
stat_model/   Original Python forecasting package and frozen model artifacts
backend/      HTTP API gateway, model integration, Foundry agents and tests
frontend/     English-language replay interface, player profiles and chat UI
```

The root package files coordinate building, testing and deployment. There are three application directories.

## Run locally

Use Node.js 22 or newer.

```sh
npm ci
npm run build
npm test
npm run check
cp backend/.dev.vars.example backend/.dev.vars
# Fill in server-side environment variables locally.
npm run dev
```

Open `http://127.0.0.1:8766`. The replay works without AI credentials. Chat requires a configured server identity and access to the Foundry project. Never put credentials in frontend files.

## Runtime architecture

The browser renders sampled player positions, match events and player profiles. The API gateway in `backend/worker.js` provides `/api/config`, `/api/backend-health`, `/api/forecast-parameters`, `/api/forecast`, `/api/models` and `/api/chat`.

The gateway supports Cloudflare Workers and the Node.js Azure App Service entry point. Chat is handled by the Azure Foundry orchestration service, which calls four independent saved agents: Twelfth Man Host, AI Coach, Rules Expert and Data Analyst. Direct rooms have separate histories. Discussion mode runs opening reports, peer responses and a Host summary. API credentials never reach the browser.

The forecast gateway reads frozen artifacts directly from `stat_model/`. Pure JavaScript inference and input conversion helpers in `frontend/` support browser replay estimates and are also imported by the gateway. Model training and original Python inference remain in `stat_model/`.

Azure App Service runs `backend/server.js` to serve the built frontend and the same API gateway under one origin. This Node.js entry point preserves streaming chat, model inference, origin validation and a per-process prototype rate cap. The existing Cloudflare deployment remains available as a separate deployment target. Foundry agents are deployed independently.

## Data and interpretation

The included match 117092 replay is derived from [SoccerTrack v2](https://huggingface.co/datasets/atomscott/soccertrack-v2), revision `325bd4c57ee8e135ab652f3921d274526ada496b`, by Atom Scott, Ikuma Uchida, Kento Kuroda, Yufi Kim and Keisuke Fujii, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Coordinates are sampled at 1 Hz, rounded, and labels normalized. Only compact web derivatives are included; raw multi-gigabyte tracking archives and videos are excluded.

The white ball is illustrative. Supplemental profile histories and live action inputs are simulated or inferred and are not verified player histories or ball measurements. Model probabilities on these inputs have not been calibrated as live match probabilities. Saved alert thresholds apply to the 30-second model output; the original validation false-positive rate does not establish a live-use false-positive rate.

See [frontend data notes](frontend/README.md) and the [original model documentation](stat_model/README.md).
