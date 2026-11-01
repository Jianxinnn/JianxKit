"""真实调用示例：在 MyKit 根目录 uv run --package mykit-jev python components/jev/python/examples/classify_tool.py
读取 components/jev/.env：EMRand_JEV_URL / EMRand_JEV_KEY / EMRand_JEV_MODEL（中转），
或官方的 TYPESAFE_API_KEY。设置 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL 后会启用备用模型和 extract。"""

import json
import os
from dataclasses import asdict, is_dataclass
from pathlib import Path

from pydantic import BaseModel

from mykit.jev import Result, create_sync_ai

env_file = Path(__file__).resolve().parents[2] / '.env'
if env_file.exists():
    for line in env_file.read_text().splitlines():
        key, sep, value = line.strip().partition('=')
        if sep and not key.startswith('#'):
            os.environ.setdefault(key.strip(), value.strip().strip('"\''))

env = os.environ
api_key = env.get('EMRand_JEV_KEY') or env.get('TYPESAFE_API_KEY')
if not api_key:
    raise SystemExit('set EMRand_JEV_KEY or TYPESAFE_API_KEY')

jev = {'api_key': api_key}
if env.get('EMRand_JEV_URL'):
    jev['url'] = env['EMRand_JEV_URL']
if env.get('EMRand_JEV_MODEL'):
    jev['model'] = env['EMRand_JEV_MODEL']

llm = None
if env.get('LLM_BASE_URL') and env.get('LLM_API_KEY') and env.get('LLM_MODEL'):
    llm = {'base_url': env['LLM_BASE_URL'], 'api_key': env['LLM_API_KEY'], 'model': env['LLM_MODEL']}

ai = create_sync_ai(jev=jev, llm=llm)

input = {
    'parts': [
        {'id': 'description', 'content': 'Predicts the binding affinity of a protein-ligand pair. Accepts a batch of up to 100 pairs.'},
        {'id': 'input-schema', 'content': {'type': 'object', 'properties': {'pairs': {'type': 'array', 'description': 'protein-ligand pairs'}}}},
        {'id': 'output-schema', 'content': {'type': 'object', 'properties': {'affinity': {'type': 'number', 'description': 'predicted pKd'}}}},
    ],
}

categories = [
    {'id': 'prediction', 'description': '预测未知结果'},
    {'id': 'scoring', 'description': '对已有对象评分'},
    {'id': 'conversion', 'description': '转换数据格式'},
]


def show(label: str, result: Result) -> None:
    data = result.data
    if isinstance(data, BaseModel):
        data = data.model_dump()
    elif is_dataclass(data) and not isinstance(data, type):
        data = asdict(data)
    print(f'\n== {label}: {result.status}  ({result.meta.provider} {result.meta.model})')
    print('data  ', json.dumps(data, ensure_ascii=False))
    for issue in result.issues:
        print('issue ', issue.code, issue.provider or '', issue.message)


show('classify single', ai.classify(input, categories, instruction='按实际能力分类'))
show('classify multi', ai.classify(input, categories, instruction='按实际能力分类', mode='multi'))
show('judge', ai.judge(input, '工具支持批量输入'))
show('judge many', ai.judge(input, statements={'batch': '工具支持批量输入', 'gpu': '工具需要 GPU'}))

if llm:
    class ToolInfo(BaseModel):
        max_batch_size: int | None
        output_unit: str | None

    show('extract', ai.extract(input, ToolInfo, instruction='提取工具的批量上限和输出单位', require_evidence=True))
