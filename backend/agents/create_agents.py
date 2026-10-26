"""Create four independently versioned Foundry prompt-agent resources."""
import hashlib
import json
from pathlib import Path

from azure.ai.projects import AIProjectClient
from azure.ai.projects.models import FunctionTool, PromptAgentDefinition, Reasoning
from azure.identity import AzureCliCredential

ROOT = Path(__file__).resolve().parent
ENDPOINT = "https://ai4soccer.services.ai.azure.com/api/projects/inside-the-game"
NAMES = {"auto": "twelfth-man-host", "coach": "twelfth-man-coach", "referee": "twelfth-man-rules", "data": "twelfth-man-data"}


def main():
    prompts = json.loads((ROOT / "src/prompts.json").read_text())
    schemas = json.loads((ROOT / "tool-schemas.json").read_text())
    registry = {}
    with AzureCliCredential() as credential, AIProjectClient(ENDPOINT, credential, allow_preview=True) as project:
        existing = {agent.name: agent for agent in project.agents.list(limit=100)}
        for role, name in NAMES.items():
            instructions = prompts["system"] + "\n" + prompts["roles"][role]["instructions"]
            allowed = set(prompts["roles"][role]["tools"])
            tools = [FunctionTool(**{k: v for k, v in schema.items() if k != "type"}) for schema in schemas if schema["name"] in allowed]
            definition = PromptAgentDefinition(model="gpt-5-mini", instructions=instructions, tools=tools, reasoning=Reasoning(effort="minimal"))
            digest = hashlib.sha256(json.dumps(definition.as_dict(), sort_keys=True).encode()).hexdigest()
            latest = existing[name].versions.latest if name in existing else None
            if latest and latest.metadata and latest.metadata.get("twelfth_man_definition_sha256") == digest:
                created = latest
            else:
                created = project.agents.create_version(agent_name=name, definition=definition, description=prompts["roles"][role]["name"] + " — independent Twelfth Man football agent", metadata={"twelfth_man_role": role, "twelfth_man_definition_sha256": digest})
            registry[role] = {"name": name, "version": created.version, "display_name": prompts["roles"][role]["name"], "tools": sorted(allowed)}
            (ROOT / "src/registry.json").write_text(json.dumps(registry, indent=2) + "\n")
            print(json.dumps({"role": role, **registry[role]}), flush=True)
    assert len(registry) == 4


if __name__ == "__main__":
    main()
