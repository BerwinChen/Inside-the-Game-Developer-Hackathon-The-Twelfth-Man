import sys
from pathlib import Path
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).parent / "src"))
from remote_agents import RemoteAgents

REGISTRY = {role: {"name": "test-" + role, "version": "7"} for role in ("auto", "coach", "referee", "data")}


class RemoteTests(unittest.IsolatedAsyncioTestCase):
    async def test_calls_persisted_role_version_without_overriding_saved_instructions(self):
        calls = []
        class Responses:
            async def create(self, **kwargs):
                calls.append(kwargs)
                return SimpleNamespace(status="completed", output=[], output_text="Evidence-based answer")
        remote = RemoteAgents(SimpleNamespace(responses=Responses()), REGISTRY)
        await remote("coach", [{"role": "user", "content": "Private coach question"}], [], "Review the supplied reports.")
        await remote("data", [{"role": "user", "content": "Private data question"}], [], "")
        self.assertEqual(calls[0]["extra_body"]["agent_reference"], {"type": "agent_reference", "name": "test-coach", "version": "7"})
        self.assertNotIn("instructions", calls[0])
        self.assertNotIn("conversation", calls[0])
        self.assertNotIn("Private coach", str(calls[1]["input"]))
        self.assertEqual(calls[0]["tool_choice"], "none")

    async def test_server_rejects_tools_outside_current_roles_allow_list(self):
        class Responses:
            async def create(self, **kwargs):
                call = SimpleNamespace(type="function_call", name="delete_match", arguments="{}", call_id="bad")
                call.model_dump = lambda **kwargs: {"type": "function_call", "name": call.name, "arguments": "{}", "call_id": "bad"}
                return SimpleNamespace(status="completed", output=[call])
        remote = RemoteAgents(SimpleNamespace(responses=Responses()), REGISTRY)
        with self.assertRaisesRegex(RuntimeError, "allowed tools"):
            await remote("referee", [], [], "")


if __name__ == "__main__":
    unittest.main()
