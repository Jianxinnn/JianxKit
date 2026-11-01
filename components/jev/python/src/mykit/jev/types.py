from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Generic, Literal, Mapping, Protocol, Sequence, TypedDict, TypeVar, Union

from pydantic import BaseModel

if TYPE_CHECKING:
    import httpx

Operation = Literal['classify', 'extract', 'judge']
Status = Literal['ok', 'needs_review', 'failed']
Mode = Literal['single', 'multi']

# ---- 输入 ----


class Part(TypedDict):
    id: str
    content: Union[str, dict[str, Any]]


class Input(TypedDict):
    parts: list[Part]


class Category(TypedDict):
    id: str
    description: str


# 方法参数接受任意 dict，形状同上面的 Input / Category。
# 运行时由 validation 检查，这样普通 dict 变量传进来不会被类型检查器拦下。
InputLike = Mapping[str, Any]
CategoryLike = Mapping[str, str]


# ---- 结果 ----

IssueCode = Literal[
    'invalid_input',  # 输入或参数不合法
    'no_provider',  # 没有能处理该请求的提供方
    'provider_error',  # 调用失败（已按需重试）
    'invalid_output',  # 返回的格式、类别或字段不合法
    'low_confidence',  # 提供方置信度低
    'undetermined',  # 资料不足以得出结论
    'bad_evidence',  # 引用的来源或原文在输入中找不到
    'missing_evidence',  # 要求引用，但没有有效引用
    'conflict',  # 提供方之间结论不一致
]


@dataclass
class Evidence:
    target: str  # 类别、判断语句的键或非 None 叶子字段的点路径，例如 items.0.name
    source_id: str  # 对应输入 part["id"]
    quote: str  # 输入资料中的原文


@dataclass
class Issue:
    code: IssueCode
    message: str
    provider: str | None = None


@dataclass
class Meta:
    provider: str
    model: str
    fallback_used: bool
    raw: Any = None  # 提供方原始概率等，只作记录，不代表正确率


T = TypeVar('T')


@dataclass
class Result(Generic[T]):
    status: Status
    data: T | None
    evidence: list[Evidence]
    issues: list[Issue]
    meta: Meta


@dataclass
class ClassifyData:
    categories: list[str]
    undetermined: bool  # 资料不足以确定


Verdicts = dict[str, Union[bool, None]]  # None 表示资料不足以判断


@dataclass
class JudgeData:
    holds: bool | None


@dataclass
class JudgeManyData:
    holds: Verdicts


# ---- 提供方接口（适配层只做协议转换）----


@dataclass
class Request:
    operation: Operation
    input: InputLike
    require_evidence: bool = False
    instruction: str | None = None
    # classify
    categories: Sequence[CategoryLike] = field(default_factory=list)
    mode: Mode = 'single'
    # extract
    schema: type[BaseModel] | None = None
    json_schema: dict[str, Any] | None = None
    # judge
    statements: dict[str, str] = field(default_factory=dict)


@dataclass
class ProviderResult:
    """data 按操作区分：classify → {"categories", "undetermined"}，extract → 符合 schema 的 dict，
    judge → Verdicts。evidence 可以是 Evidence 或 {"target", "sourceId", "quote"}。
    适配器只负责转换，内容由 runner 统一校验。"""

    model: str
    data: Any
    evidence: list[Any] = field(default_factory=list)
    issues: list[Issue] = field(default_factory=list)  # 提供方自己发现的问题，例如置信度低
    raw: Any = None


class Provider(Protocol):
    name: str

    def supports(self, request: Request) -> bool: ...

    async def run(self, request: Request) -> ProviderResult: ...


# ---- 配置 ----


@dataclass
class JevConfig:
    api_key: str
    url: str = 'https://api.typesafe.ai/v1/systemone'  # 完整接口地址；用中转时填中转地址
    model: str = 'jev-latest'
    min_confidence: float = 0.5  # Choice 置信度低于此值时 needs_review
    noul_yes: float = 0.7  # 多标签：概率 ≥ 此值算选中
    noul_no: float = 0.3  # 多标签：概率 ≤ 此值算不选
    timeout: float = 30.0  # 秒
    transport: httpx.AsyncBaseTransport | None = None  # 测试时注入


@dataclass
class LlmConfig:
    base_url: str  # OpenAI 兼容接口，例如 https://api.openai.com/v1
    api_key: str
    model: str
    temperature: float = 0
    json_mode: bool = True  # 是否发送 response_format: json_object
    timeout: float = 120.0
    transport: httpx.AsyncBaseTransport | None = None
