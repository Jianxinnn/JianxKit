import json

from mykit.reflection import Verdict, reflect, run_with_reflection

NOTE = {"failure_reason": "off by one", "next_step": "use <= in the loop", "avoid": ["changing tests", " "], "failure_type": "logic"}


def test_reflect_parses_json_and_embedded_json():
    for text in (json.dumps(NOTE), "Here you go:\n" + json.dumps(NOTE) + "\nthanks"):
        note = reflect(lambda prompt: text, "task", "summary", "2 tests failed")
        assert (note.failure_reason, note.next_step, note.failure_type) == ("off by one", "use <= in the loop", "logic")
        assert note.avoid == ["changing tests"]


def test_reflect_falls_back_when_not_json():
    note = reflect(lambda prompt: "the loop bound is wrong", "task", "summary", "failed")
    assert note.failure_type == "parse_failure"
    assert note.failure_reason == "the loop bound is wrong"


def test_critic_sees_task_attempt_and_feedback():
    prompts = []
    reflect(lambda prompt: prompts.append(prompt) or json.dumps(NOTE), "fix sum()", "I changed nothing", "AssertionError: 5 != 6")
    assert "fix sum()" in prompts[0] and "I changed nothing" in prompts[0] and "AssertionError: 5 != 6" in prompts[0]


def test_retry_gets_guidance_and_passes():
    prompts = []

    def attempt(prompt):
        prompts.append(prompt)
        return "v2" if "Retry guidance" in prompt else "v1"

    run = run_with_reflection(
        "fix sum()",
        attempt=attempt,
        verify=lambda output: Verdict(output == "v2", "expected v2"),
        ask=lambda prompt: json.dumps(NOTE),
        max_retries=2,
    )
    assert (run.passed, run.attempts, run.output) == (True, 2, "v2")
    assert prompts[0] == "fix sum()"
    assert prompts[1].startswith("fix sum()\n\nRetry guidance:") and "- Avoid: changing tests" in prompts[1]
    assert len(run.notes) == 1


def test_no_critic_call_when_first_attempt_passes_or_no_retries_left():
    def ask(prompt):
        raise AssertionError("critic should not be called")

    passed = run_with_reflection("t", attempt=lambda p: "ok", verify=lambda o: Verdict(True), ask=ask)
    assert (passed.passed, passed.attempts, passed.notes) == (True, 1, [])
    failed = run_with_reflection("t", attempt=lambda p: "bad", verify=lambda o: Verdict(False, "no"), ask=ask, max_retries=0)
    assert (failed.passed, failed.attempts, failed.verdict.feedback) == (False, 1, "no")
