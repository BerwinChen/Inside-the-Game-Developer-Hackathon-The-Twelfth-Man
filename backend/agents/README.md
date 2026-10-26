# Independent Foundry agents

Application author: berwin

| Role | Saved prompt-agent resource |
| --- | --- |
| Twelfth Man Host | `twelfth-man-host` |
| AI Coach | `twelfth-man-coach` |
| Rules Expert | `twelfth-man-rules` |
| Data Analyst | `twelfth-man-data` |

`src/registry.json` pins role versions. `twelfth-man-team` is the hosted orchestration service, not an additional expert. Direct conversations invoke the selected role. Discussion invokes three expert openings, three peer responses and a Host summary. History and evidence tools are request-scoped; private-room histories are not shared.

## Setup and deployment

Use Python 3.14 and Azure CLI with access to the project. Run from this directory:

```sh
python3.14 -m venv .venv
. .venv/bin/activate
pip install -r src/requirements.txt
az login --use-device-code
python -m unittest discover -s . -p 'test_*.py'
python create_agents.py
python deploy.py --check
python deploy.py --package
# Creates and activates a hosted version:
python deploy.py
```

Project endpoint: `https://ai4soccer.services.ai.azure.com/api/projects/inside-the-game`. Model deployment: `gpt-5-mini`.

`deploy.py` uploads only six allow-listed source files using Foundry remote builds; local Docker is not required. `deployment.json` is ignored and supports `python deploy.py --resume`. Existing unrelated agents are not changed. Keep CLI login state, environment files, credentials, virtual environments and archives out of Git.

## Gateway contract

The gateway sends `message`, `agent` (`auto`, `coach`, `referee`, `data`), `mode` (`direct` or `discussion`), room `history` and captured replay `snapshot`. Times are seconds and future events are rejected. `stream: false` returns JSON; SSE emits role progress, reports, answer deltas and completion. A `healthCheck` request verifies readiness without model inference.

The hosted service uses managed identity for model inference. The current Cloudflare gateway authenticates with its project-scoped server identity. Browser clients receive neither credential. Web search is disabled in this hosted version; current external facts are not claimed as verified. Numerical forecast queries are not yet exposed as agent tools.
