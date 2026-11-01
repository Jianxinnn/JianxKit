"""基本 reflection：失败后让 critic 总结原因和下一步，把它附在任务后面重试。

    from mykit.reflection import Verdict, run_with_reflection
    run = run_with_reflection(task, attempt=solve, verify=check, ask=critic_llm, max_retries=1)
"""

from .core import CRITIC_PROMPT, ReflectionNote, ReflectionRun, Verdict, reflect, run_with_reflection

__all__ = ["CRITIC_PROMPT", "ReflectionNote", "ReflectionRun", "Verdict", "reflect", "run_with_reflection"]
