"""Foundry Invocations protocol: existing Twelfth Man JSON/SSE contract."""
import asyncio
import json
import os
from functools import lru_cache
from azure.ai.projects.aio import AIProjectClient
from azure.identity.aio import DefaultAzureCredential as AsyncCredential

from azure.ai.agentserver.invocations import InvocationAgentServerHost
from starlette.responses import JSONResponse, StreamingResponse

from team import run_team, validate_request
from remote_agents import RemoteAgents

app = InvocationAgentServerHost()


@lru_cache(maxsize=1)
def remote():
    project = AIProjectClient(os.environ["FOUNDRY_PROJECT_ENDPOINT"], AsyncCredential(), allow_preview=True)
    return RemoteAgents(project.get_openai_client())


@app.invoke_handler
async def invoke(request):
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > 192 * 1024:
            return JSONResponse({"error": "Request is too large."}, status_code=413)
    try:
        body = json.loads(raw)
        if isinstance(body, dict) and body.get("healthCheck") is True:
            from pathlib import Path
            registry = json.loads(Path(__file__).with_name("registry.json").read_text())
            return JSONResponse({"status": "ready", "backend": "foundry", "agents": {role: item["name"] for role, item in registry.items()}})
        validate_request(body)
    except (ValueError, TypeError):
        return JSONResponse({"error": "Invalid conversation or replay snapshot."}, status_code=400)
    if body.get("stream", True) is False:
        try:
            result = await run_team(body, None, lambda event: None, remote_executor=remote())
            return JSONResponse(result)
        except Exception:
            return JSONResponse({"error": "The AI team could not complete this request."}, status_code=502)

    async def stream():
        # Output is bounded by model token limits; allow bursts of text deltas.
        queue = asyncio.Queue()
        async def produce():
            try:
                await run_team(body, None, queue.put_nowait, remote_executor=remote())
            except asyncio.CancelledError:
                raise
            except Exception:
                await queue.put({"type": "error", "message": "The AI team could not complete this request."})
            finally:
                await queue.put(None)
        task = asyncio.create_task(produce())
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                except TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                if event is None:
                    break
                yield "data: " + json.dumps(event, ensure_ascii=False) + "\n\n"
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


if __name__ == "__main__":
    app.run()
