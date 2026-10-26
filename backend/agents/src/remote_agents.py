"""Invoke persisted Foundry agents; execute only request-scoped allowed functions."""
import json
from pathlib import Path
from types import SimpleNamespace


class RemoteAgents:
    def __init__(self, openai, registry=None):
        self.openai = openai
        self.registry = registry if registry is not None else json.loads(Path(__file__).with_name("registry.json").read_text())
        if set(self.registry) != {"auto", "coach", "referee", "data"}:
            raise ValueError("All four independent Foundry agents must be registered.")

    async def __call__(self, role, messages, tools, phase_prompt):
        reference = self.registry[role]
        # No conversation ID or previous response is reused between private rooms or participants.
        inputs = [{"type": "message", **message} for message in messages]
        if phase_prompt:
            inputs.append({"type": "message", "role": "developer", "content": phase_prompt})
        permitted = {f.__name__: f for f in tools}
        count = 0
        for iteration in range(5):
            response = await self.openai.responses.create(
                input=inputs, store=False, include=["reasoning.encrypted_content"],
                max_output_tokens=1800, tool_choice="none" if not permitted or iteration == 4 else "auto",
                extra_body={"agent_reference": {"type": "agent_reference", "name": reference["name"], "version": reference["version"]}},
            )
            if response.status != "completed":
                raise RuntimeError("Independent Foundry agent did not complete its response.")
            calls = [item for item in response.output if item.type == "function_call"]
            if not calls:
                if not response.output_text:
                    raise RuntimeError("Independent Foundry agent returned no answer.")
                return SimpleNamespace(text=response.output_text)
            inputs.extend(item.model_dump(exclude_none=True) for item in response.output)
            for call in calls:
                count += 1
                if count > 12 or call.name not in permitted:
                    raise RuntimeError("Independent agent exceeded its allowed tools.")
                try:
                    arguments = json.loads(call.arguments)
                    output = permitted[call.name](**arguments)
                except (ValueError, TypeError, KeyError):
                    output = json.dumps({"error": "Invalid replay query; use only available players and captured past times."})
                inputs.append({"type": "function_call_output", "call_id": call.call_id, "output": output})
        raise RuntimeError("Independent agent exceeded the tool-call round limit.")
