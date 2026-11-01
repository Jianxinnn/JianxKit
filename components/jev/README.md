# jev

提供分类、提取、判断三个接口。Jev 负责分类和判断，普通语言模型补充提取、原文引用及降级。模块只返回结果；文件解析、任务调度、存储和人工审核由业务处理。

复刻自 [EnzymeGroup/jev-base](https://github.com/EnzymeGroup/jev-base)（c9a19fd），只改了包名和路径，来源记录见 [component.toml](component.toml)。

Python 和 TypeScript 两种实现，接口相同。Python 同步代码用 `create_sync_ai`，已有事件循环时用 `create_ai` 并 `await`；TypeScript 需要 Node.js 22.13+。

## 用法

输入统一为 `parts`，每部分包含唯一 `id` 和文本或 JSON 对象 `content`。分类表由调用方提供。

### TypeScript

```ts
import { createAI } from '@mykit/jev'
import { z } from 'zod'

const ai = createAI({ jev: { apiKey: process.env.TYPESAFE_API_KEY! } })
const input = { parts: [{ id: 'description', content: '预测结合亲和力，支持批量输入。' }] }
const categories = [
  { id: 'prediction', description: '预测未知结果' },
  { id: 'conversion', description: '转换数据格式' },
]

const result = await ai.classify({ input, categories }) // mode: 'single'（默认）或 'multi'
await ai.judge({ input, statement: '工具支持批量输入' })
await ai.judge({ input, statements: { batch: '支持批量输入', gpu: '需要 GPU' } })

// 需先配置 llm，见下方配置表。
await ai.extract({
  input,
  schema: z.object({ maxBatchSize: z.number().nullable() }),
  instruction: '提取批量上限，未提及则返回 null',
})
```

### Python

```python
import os
from pydantic import BaseModel
from mykit.jev import create_sync_ai

ai = create_sync_ai(jev={'api_key': os.environ['TYPESAFE_API_KEY']})
input = {'parts': [{'id': 'description', 'content': '预测结合亲和力，支持批量输入。'}]}
categories = [
    {'id': 'prediction', 'description': '预测未知结果'},
    {'id': 'conversion', 'description': '转换数据格式'},
]

result = ai.classify(input, categories)  # mode='single'（默认）或 'multi'
ai.judge(input, '工具支持批量输入')
ai.judge(input, statements={'batch': '支持批量输入', 'gpu': '需要 GPU'})

# 需先配置 llm，见下方配置表。
class ToolInfo(BaseModel):
    max_batch_size: int | None

ai.extract(input, ToolInfo, instruction='提取批量上限，未提及则返回 null')
```

三个方法都支持要求原文引用：TypeScript 传 `requireEvidence: true`，Python 传 `require_evidence=True`。提取按 schema 校验，不自动将数字字符串转换成数字。

## 配置

传给 `createAI` / `create_sync_ai`；Python 使用 snake_case 字段名。

| 配置 | TypeScript | Python |
|---|---|---|
| Jev | `jev: { apiKey, url?, model? }` | `jev={'api_key': key, 'url': url, 'model': model}` |
| 聊天模型 | `llm: { baseURL, apiKey, model }` | `llm={'base_url': url, 'api_key': key, 'model': model}` |
| 额外提供方 | `providers: [provider]` | `providers=[provider]` |

- `jev.url` 填完整端点，默认 `https://api.typesafe.ai/v1/systemone`；当前中转填 `https://emrank.tech/v1/decisions`，模型填 `typesafe/jev-1.14.0`。
- `llm.baseURL` 填 OpenAI 兼容接口前缀，例如以 `/v1` 结尾；模块会追加 `/chat/completions`。不接受 JSON 模式的服务可设 `jsonMode: false` / `json_mode=False`。
- 当前中转只提供 Jev。`extract` 和要求引用的调用直接使用聊天模型，未配置时返回 `failed` / `no_provider`。
- 提供方按 Jev、llm、自定义的顺序尝试。需要其他顺序时只传 `providers`，注册导出的 Jev / llm 适配器即可。

完整配置、默认阈值及扩展接口见 [TypeScript 类型](typescript/src/types.ts) / [Python 类型](python/src/mykit/jev/types.py)。

## 结果与处理规则

| 字段 | 含义 |
|---|---|
| `status` | `ok` 校验通过；`needs_review` 有候选但需确认；`failed` 无可用结果 |
| `data` | 分类：`categories`、`undetermined`；判断：`holds`（布尔值或 null，多句时为映射）；提取：符合 schema 的数据 |
| `evidence` | 原文引用，包含 `target`、`sourceId`（Python 为 `source_id`）、`quote` |
| `issues` | 问题列表，包含 `code`、`message` 和可选 `provider` |
| `meta` | 提供方、模型版本、是否降级及可选原始概率 |

`ok` 不代表自动采用，原始概率不等于正确率。提供方故障恢复后，`ok` 结果的 `issues` 仍可能包含之前的失败记录。

- 输入和输出统一校验。暂时性故障默认重试 2 次；无效结果或永久性错误直接降级。支持 `Retry-After` 秒数和 HTTP 日期，等待超过 30 秒时直接降级。
- 不确定结果保留作候选并尝试下一提供方；逐项比较明确结论，冲突进入待确认，未知值可由后续结果补全。
- 要求引用时，每个选中类别、明确判断、非 null 提取叶子字段都需有对应引用。嵌套路径如 `items.0.name`，空数组和空对象无需引用。
- 引用检查保留大小写、标点和数学符号，只统一全半角 ASCII、Unicode 组合形式及连续空白；结构化资料按模型收到的带缩进 JSON 检查。代码验证原文存在，是否支持结论仍需业务评估。

## 运行完整示例

示例脚本会读取本组件目录下的 `components/jev/.env`（已被 .gitignore 忽略），模块本身不自动读取。当前中转配置：

```sh
EMRand_JEV_URL=https://emrank.tech/v1/decisions
EMRand_JEV_KEY=你的密钥
EMRand_JEV_MODEL=typesafe/jev-1.14.0
```

先在 MyKit 根目录 `npm install`，然后任选一种语言运行：

```sh
(cd components/jev/typescript && npm run example)
uv run --package mykit-jev python components/jev/python/examples/classify_tool.py
```

离线测试（不调用真实接口）：`uv run pytest components/jev`、`npm test -w @mykit/jev`。

示例也支持官方 `TYPESAFE_API_KEY`；同时设置 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL` 可启用聊天模型及提取示例。
