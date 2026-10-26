"""Deploy only src/ through Foundry's remote source build; never upload secrets."""
import argparse
import hashlib
import json
import os
import time
import zipfile
from pathlib import Path

from azure.ai.projects import AIProjectClient
from azure.ai.projects.models import (
    AgentEndpointConfig, CodeConfiguration, CodeDependencyResolution,
    FixedRatioVersionSelectionRule, HostedAgentDefinition,
    InvocationsProtocolConfiguration, ProtocolConfiguration,
    ProtocolVersionRecord, VersionSelector,
)
from azure.identity import AzureCliCredential

ROOT = Path(__file__).resolve().parent
ENDPOINT = "https://ai4soccer.services.ai.azure.com/api/projects/inside-the-game"
NAME = "twelfth-man-team"
FILES = ("main.py", "team.py", "prompts.json", "requirements.txt", "remote_agents.py", "registry.json")


def package():
    archive = ROOT / "twelfth-man-team.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
        for name in FILES:
            z.write(ROOT / "src" / name, name)
    return archive


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="Read existing agents and check authentication only")
    parser.add_argument("--package", action="store_true", help="Build the allow-listed source archive without network calls")
    parser.add_argument("--resume", action="store_true", help="Resume monitoring an already recorded version without uploading again")
    args = parser.parse_args()
    if args.package:
        archive = package()
        print(json.dumps({"archive": str(archive), "files": FILES, "sha256": hashlib.sha256(archive.read_bytes()).hexdigest()}))
        return
    with AzureCliCredential() as credential, AIProjectClient(endpoint=ENDPOINT, credential=credential, allow_preview=True) as project:
        if args.check:
            agents = list(project.agents.list(limit=20))
            print(json.dumps({"accessible": True, "existing_agents": [a.name for a in agents]}))
            return
        archive = package()
        path = ROOT / "deployment.json"
        if args.resume:
            record = json.loads(path.read_text())
            created = project.agents.get_version(agent_name=NAME, agent_version=record["version"])
        else:
            with archive.open("rb") as source:
                created = project.agents.create_version_from_code(
                    agent_name=NAME,
                    description="Twelfth Man orchestration service: invokes four separately registered Foundry agents for private conversations and two-round discussion.",
                    definition=HostedAgentDefinition(
                        cpu="0.5", memory="1Gi",
                        code_configuration=CodeConfiguration(runtime="python_3_14", entry_point=["python", "main.py"], dependency_resolution=CodeDependencyResolution.REMOTE_BUILD),
                        environment_variables={"FOUNDRY_PROJECT_ENDPOINT": ENDPOINT, "FOUNDRY_MODEL_NAME": "gpt-5-mini", "PYTHONNOUSERSITE": "1"},
                        protocol_versions=[ProtocolVersionRecord(protocol="invocations", version="2.0.0")],
                    ), code=source,
                )
        # Persist immediately so a retry can inspect this version instead of creating duplicates.
        record = {"project_endpoint": ENDPOINT, "agent": NAME, "version": created.version, "status": getattr(created.status, "value", str(created.status)), "source_sha256": hashlib.sha256(archive.read_bytes()).hexdigest()}
        path.write_text(json.dumps(record, indent=2) + "\n")
        for attempt in range(90):
            details = project.agents.get_version(agent_name=NAME, agent_version=created.version)
            status = getattr(details.status, "value", str(details.status))
            print(json.dumps({"agent": NAME, "version": created.version, "status": status}), flush=True)
            if status.lower() == "active":
                break
            if status.lower() == "failed":
                raise RuntimeError("Foundry source build failed; inspect the version in the project portal.")
            time.sleep(10)
        else:
            raise TimeoutError("Source build is still pending. Inspect deployment.json before retrying.")
        project.agents.update_details(
            agent_name=NAME,
            agent_endpoint=AgentEndpointConfig(
                version_selector=VersionSelector(version_selection_rules=[FixedRatioVersionSelectionRule(agent_version=created.version, traffic_percentage=100)]),
                protocol_configuration=ProtocolConfiguration(invocations=InvocationsProtocolConfiguration()),
            ),
        )
        record.update(status="active", endpoint=f"{ENDPOINT}/agents/{NAME}/endpoint/protocols/invocations")
        path.write_text(json.dumps(record, indent=2) + "\n")
        print(json.dumps(record), flush=True)


if __name__ == "__main__":
    main()
