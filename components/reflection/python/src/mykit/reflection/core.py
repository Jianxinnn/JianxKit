"""Adapted from learn-claude-code Agent-demo: demo_common/reflection.py (ReflectionNote, ReflectionCritic)
and the verify-retry loop in demo_common/workflows.py."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Callable

CRITIC_PROMPT = (
    "You are a critic for an agent. "
    "Given the task, the agent summary, and the verifier result, "
    "return a JSON object with keys: failure_reason, next_step, avoid, failure_type. "
    "The avoid field must be a short list of strings. Do not use markdown."
)


@dataclass
class ReflectionNote:
    failure_reason: str
    next_step: str
    avoid: list[str]
    failure_type: str
    raw_text: str

    def render_for_retry(self) -> str:
        lines = [
            "Retry guidance:",
            f"- Failure reason: {self.failure_reason}",
            f"- Next step: {self.next_step}",
        ]
        for item in self.avoid:
            lines.append(f"- Avoid: {item}")
        return "\n".join(lines)


@dataclass(frozen=True)
class Verdict:
    passed: bool
    feedback: str = ""  # 失败原因、测试输出等，交给 critic


@dataclass
class ReflectionRun:
    passed: bool
    attempts: int
    output: str  # 最后一次尝试的输出
    verdict: Verdict  # 最后一次验证结果
    notes: list[ReflectionNote] = field(default_factory=list)


def reflect(
    ask: Callable[[str], str],
    task: str,
    attempt_summary: str,
    feedback: str,
    *,
    critic_prompt: str = CRITIC_PROMPT,
) -> ReflectionNote:
    """让 critic 读任务、尝试结果和验证反馈，返回结构化的失败原因和下一步。ask 是一次模型调用。"""
    prompt = (
        f"{critic_prompt}\n\n"
        "Task:\n"
        f"{task}\n\n"
        "Agent summary:\n"
        f"{attempt_summary}\n\n"
        "Verifier result:\n"
        f"{feedback}\n"
    )
    text = ask(prompt)
    data = _parse_json(text)
    return ReflectionNote(
        failure_reason=str(data.get("failure_reason", "Unknown failure")).strip(),
        next_step=str(data.get("next_step", "Inspect the verifier output more closely.")).strip(),
        avoid=[str(item).strip() for item in data.get("avoid", []) if str(item).strip()],
        failure_type=str(data.get("failure_type", "general_failure")).strip(),
        raw_text=text,
    )


def run_with_reflection(
    task: str,
    attempt: Callable[[str], str],
    verify: Callable[[str], Verdict],
    ask: Callable[[str], str],
    *,
    max_retries: int = 1,
    critic_prompt: str = CRITIC_PROMPT,
) -> ReflectionRun:
    """尝试 → 验证 → 失败则反思 → 带着反思重试，最多重试 max_retries 次。

    attempt(prompt) 执行一次任务并返回输出；第一次 prompt 是 task，之后是 task 加上 retry guidance。
    verify(output) 判断是否通过。ask(prompt) 是给 critic 用的一次模型调用。
    """
    prompt = task
    notes: list[ReflectionNote] = []
    for retry_index in range(max_retries + 1):
        output = attempt(prompt)
        verdict = verify(output)
        if verdict.passed or retry_index >= max_retries:
            return ReflectionRun(verdict.passed, retry_index + 1, output, verdict, notes)
        note = reflect(ask, task, output, verdict.feedback, critic_prompt=critic_prompt)
        notes.append(note)
        prompt = task + "\n\n" + note.render_for_retry()
    raise AssertionError("unreachable")


def _parse_json(text: str) -> dict[str, Any]:
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            parsed = json.loads(match.group(0))
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass

    return {
        "failure_reason": text.strip() or "Unknown failure",
        "next_step": "Re-read the verifier feedback before retrying.",
        "avoid": [],
        "failure_type": "parse_failure",
    }
