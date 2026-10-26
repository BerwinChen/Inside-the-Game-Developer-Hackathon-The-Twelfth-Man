"""Authenticated end-to-end smoke test; never prints access tokens."""
import argparse
import asyncio
import json
from pathlib import Path
import sys

from azure.identity import AzureCliCredential
from azure.ai.projects import AIProjectClient
from azure.core.rest import HttpRequest

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))


def body(mode="direct", role="data"):
    return {"message": "Use the match summary tool to report the replay clock. Then briefly explain what extra evidence you would need to analyze this match. Keep each contribution very short.", "agent": role, "mode": mode, "stream": False, "snapshot": {"matchId": "deployment-smoke-test", "time": 12, "half": 1, "home": "Green Team", "away": "Blue Team", "synthetic": True, "players": [], "events": [], "score": {"home": 0, "away": 0}}}


async def local_framework():
    from agent_framework.foundry import FoundryChatClient
    from team import run_team
    client = FoundryChatClient(project_endpoint="https://ai4soccer.services.ai.azure.com/api/projects/inside-the-game", model="gpt-5-mini", credential=AzureCliCredential(), function_invocation_configuration={"max_iterations": 5, "max_function_calls": 12, "max_duration_seconds": 60})
    events = []
    result = await run_team(body("discussion"), client, events.append)
    errors = [e for e in events if e.get("error")]
    print(json.dumps({"agents": result["agents"], "sources": result["sources"], "reports": len([e for e in events if e["type"] == "discussion_message"]), "failed_participants": len(errors), "answer": result["parts"][0]["text"]}, ensure_ascii=False))
    assert len(result["agents"]) == 4 and not errors


def hosted():
    record = json.loads((ROOT / "deployment.json").read_text())
    endpoint = record["endpoint"]
    with AzureCliCredential() as credential, AIProjectClient(record["project_endpoint"], credential, allow_preview=True) as project:
        for role in ("auto", "coach", "referee", "data"):
            response = project.send_request(HttpRequest("POST", endpoint + "?api-version=v1", json=body(role=role)), connection_timeout=15, read_timeout=120)
            payload = response.json()
            assert response.status_code == 200 and payload.get("type") == "done" and payload.get("agents") == [role], payload
            print(json.dumps({"role": role, "status": "passed", "sources": payload["sources"], "answer": payload["parts"][0]["text"]}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--local-framework", action="store_true")
    args = parser.parse_args()
    if args.local_framework:
        asyncio.run(local_framework())
    else:
        hosted()
