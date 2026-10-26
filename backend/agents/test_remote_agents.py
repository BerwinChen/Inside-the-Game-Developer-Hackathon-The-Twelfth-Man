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

class StreamingTests(unittest.IsolatedAsyncioTestCase):
    async def test_text_is_forwarded_before_completion_and_stream_is_closed(self):
        received, requests = [], []
        class Stream:
            closed = False
            async def close(self): self.closed = True
            async def __aiter__(self):
                yield SimpleNamespace(type="response.output_text.delta", delta="Live ")
                self_seen = bool(received)
                if not self_seen: raise AssertionError("Text was buffered until completion")
                yield SimpleNamespace(type="response.output_text.delta", delta="answer")
                yield SimpleNamespace(type="response.completed", response=SimpleNamespace(status="completed", output=[], output_text="Live answer"))
        stream = Stream()
        class Responses:
            async def create(self, **kwargs): requests.append(kwargs);return stream
        remote = RemoteAgents(SimpleNamespace(responses=Responses()), REGISTRY)
        result = await remote("data", [], [], "", on_event=received.append)
        self.assertEqual([e["text"] for e in received], ["Live ", "answer"])
        self.assertTrue(result.streamed)
        self.assertTrue(stream.closed)
        self.assertTrue(requests[0]["stream"])

    async def test_interrupted_stream_is_not_accepted_as_a_completed_answer(self):
        class Stream:
            closed = False
            async def close(self): self.closed = True
            async def __aiter__(self):
                yield SimpleNamespace(type="response.output_text.delta", delta="Partial")
        stream = Stream()
        class Responses:
            async def create(self, **kwargs): return stream
        remote = RemoteAgents(SimpleNamespace(responses=Responses()), REGISTRY)
        with self.assertRaisesRegex(RuntimeError, "before completion"):
            await remote("data", [], [], "", on_event=lambda _: None)
        self.assertTrue(stream.closed)


    async def test_tool_round_resets_provisional_text_and_submits_real_output(self):
        received, requests = [], []
        call = SimpleNamespace(type="function_call", name="get_match_summary", arguments="{}", call_id="summary-call")
        call.model_dump = lambda **kwargs: {"type":"function_call", "name":call.name,"arguments":"{}","call_id":call.call_id}
        responses = [SimpleNamespace(status="completed",output=[call]),SimpleNamespace(status="completed",output=[],output_text="00:12")]
        class Stream:
            def __init__(self, result, text): self.result,self.text=result,text
            async def close(self): pass
            async def __aiter__(self):
                yield SimpleNamespace(type="response.output_text.delta",delta=self.text)
                yield SimpleNamespace(type="response.completed",response=self.result)
        class Responses:
            async def create(self, **kwargs):
                requests.append({**kwargs,"input":list(kwargs["input"])})
                return Stream(responses.pop(0),"Checking" if len(requests)==1 else "00:12")
        def get_match_summary(): return '{"replayClock":"00:12"}'
        remote=RemoteAgents(SimpleNamespace(responses=Responses()),REGISTRY)
        result=await remote("data",[],[get_match_summary],"",on_event=received.append)
        self.assertEqual([e["type"] for e in received],["delta","reset","delta"])
        self.assertEqual(requests[1]["input"][-1],{"type":"function_call_output","call_id":"summary-call","output":'{"replayClock":"00:12"}'})
        self.assertEqual(result.text,"00:12")


if __name__ == "__main__":
    unittest.main()
