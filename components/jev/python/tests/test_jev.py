"""离线测试：用 httpx.MockTransport 代替 Jev 接口。"""

import json

import httpx

from mykit.jev import create_sync_ai

INPUT = {'parts': [{'id': 'description', 'content': '预测结合亲和力，支持批量输入。'}]}
CATEGORIES = [
    {'id': 'prediction', 'description': '预测未知结果'},
    {'id': 'conversion', 'description': '转换数据格式'},
]


def jev_ai(answers, seen=None):
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        if seen is not None:
            seen.append(body)
        return httpx.Response(200, json={'model': 'jev-test', 'answers': answers(body)})

    return create_sync_ai(jev={'api_key': 'test-key', 'transport': httpx.MockTransport(handler)})


def test_classify_single_sends_state_and_reads_choice():
    seen = []
    ai = jev_ai(lambda body: {'category': {'type': 'choice', 'choice': 'prediction', 'confidence': 0.9}}, seen)
    result = ai.classify(INPUT, CATEGORIES)
    assert result.status == 'ok'
    assert result.data.categories == ['prediction']
    assert result.meta.provider == 'jev'
    assert seen[0]['state'] == {'description': '预测结合亲和力，支持批量输入。'}
    assert set(seen[0]['questions']['category']['criteria']) == {'prediction', 'conversion', '__undetermined__'}


def test_judge_with_low_confidence_needs_review():
    ai = jev_ai(lambda body: {'s0': {'type': 'choice', 'choice': 'holds', 'confidence': 0.2}})
    result = ai.judge(INPUT, '工具支持批量输入')
    assert result.status == 'needs_review'
    assert result.data.holds is True
    assert any(issue.code == 'low_confidence' for issue in result.issues)


def test_invalid_input_fails_without_calling_jev():
    ai = jev_ai(lambda body: (_ for _ in ()).throw(AssertionError('should not be called')))
    result = ai.classify({'parts': []}, CATEGORIES)
    assert result.status == 'failed'
    assert result.issues[0].code == 'invalid_input'
