# Frontend

English-language 2D match replay, player profiles, compact 1s/3s/30s forecasts, floating match view and independent agent conversations.

Run `npm run build` from the repository root. `build.mjs` copies an explicit allow-list of public assets to `frontend/dist/`; backend files, credentials and model artifact files are excluded. `replays/` contains the compact two-half match sample. `samples/` contains synthetic development fixtures. Serve through the backend during local development with `npm run dev`.

## Data credits

[SoccerTrack v2](https://huggingface.co/datasets/atomscott/soccertrack-v2), revision `325bd4c57ee8e135ab652f3921d274526ada496b`, by Atom Scott, Ikuma Uchida, Kento Kuroda, Yufi Kim and Keisuke Fujii. [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Derived match 117092 positions are sampled at 1 Hz and rounded to 0.001 m; event labels and identities are normalized for replay. The source includes player tracking and events, but does not supply measured ball motion or the displayed supplemental histories. The white ball is illustrative; supplemental biography and history fields are simulated. Team names Green Team and Blue Team are display labels. Missing observations remain missing. `replays/coverage-report.json` records source sampling diagnostics; its source-only notes do not describe later simulated profile enrichment.

## Shared helpers

`forecast-adapter.js` converts enriched actions into model inputs. `forecast-kernel.js` evaluates frozen parameters. These pure helpers are imported by the API gateway as well as the browser to keep calculations aligned. The statistical model source and frozen parameters belong to `../stat_model/`.

## Hosting

The Azure App Service entry point serves this build with the API on the same origin. No frontend credential is required. For a separately hosted frontend, `TWELFTH_MAN_API_ORIGIN` may be set at build time to an HTTPS API origin; `api-config.js` and the content security policy are generated accordingly. The API must explicitly allow that frontend origin. Local and current same-origin builds leave the value unset.
