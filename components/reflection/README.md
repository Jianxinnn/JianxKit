# reflection

基本 reflection（Reflexion 式）：一次尝试没通过验证时，让 critic 读任务、尝试结果和验证反馈，总结失败原因、下一步和要避免的做法，把这段总结附在任务后面重试。只用 Python 标准库。

复刻自 learn-claude-code 下 `Agent-demo/` 的 `demo_common/reflection.py` 和 `workflows.py` 里的 verify → retry 流程，来源记录见 [component.toml](component.toml)。

## 用法

```python
from mykit.llm_call import call_llm
from mykit.reflection import Verdict, run_with_reflection

def solve(prompt: str) -> str:      # 执行一次任务，比如跑一轮 react-loop，返回输出或总结
    ...

def check(output: str) -> Verdict:  # 验证：跑测试、打分、规则检查
    return Verdict(passed=..., feedback="失败原因或测试输出")

run = run_with_reflection(task, attempt=solve, verify=check, ask=call_llm, max_retries=1)
run.passed, run.attempts, run.output
run.notes  # 每次失败后的 ReflectionNote：failure_reason / next_step / avoid / failure_type
```

- `ask` 是一次模型调用（`str -> str`），[llm-call](../llm-call/README.md) 的 `call_llm` 可以直接用；两个组件互不依赖。
- 第一次尝试收到的 prompt 就是 `task`；之后是 `task` 加上 `note.render_for_retry()`。
- 只想要单次反思时用 `reflect(ask, task, attempt_summary, feedback)`。
- critic 没返回 JSON 时不报错：`failure_type` 为 `parse_failure`，原文放进 `failure_reason`。
- 换 critic 的指令用 `critic_prompt=`。

## 和原代码的差异

- critic 不再绑定 demo 里的 `SimpleAgent`，改为传入任意 `ask` 函数；验证器、尝试函数也都由调用方传入。
- critic 指令从 "coding agent" 改为通用的 "agent"；解析失败时的建议不再提测试文件。
- 没有复刻跨任务的经验库（`reflexion_store.py`，按任务标签存取 lesson）。
