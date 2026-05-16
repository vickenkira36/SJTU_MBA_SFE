# Roche Galileo LLM API 配置指南

## 概述

通过 Roche 内部的 Portkey 网关（`eu.aigw.galileo.roche.com`）调用大模型 API，当前使用模型为 `eu.anthropic.claude-opus-4-7`。

## 前置条件

| 项目 | 说明 |
|------|------|
| Python | 3.10+ |
| 依赖包 | `requests` |
| 环境变量 | `PORTKEY_API_KEY`（Portkey 网关的 API Key） |

安装依赖：

```bash
pip install requests
```

## API 基本信息

| 参数 | 值 |
|------|-----|
| Endpoint | `https://eu.aigw.galileo.roche.com/v1/chat/completions` |
| 认证方式 | Header `x-portkey-api-key` |
| 默认模型 | `eu.anthropic.claude-opus-4-7` |
| 默认 max_tokens | `9000`（约 3000 个中文字） |

## curl 调用示例

```bash
curl https://eu.aigw.galileo.roche.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-portkey-api-key: $PORTKEY_API_KEY" \
  -d '{
    "model": "eu.anthropic.claude-opus-4-7",
    "max_tokens": 9000,
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "explain the nature of the black hole?"}
    ]
  }'
```

## Python 封装

项目根目录下的 `llm_client.py` 提供了两个函数：

### `chat(messages, model, max_tokens)` — 底层调用

接收完整的 messages 列表，返回原始 JSON 响应。

```python
from llm_client import chat

result = chat(
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "什么是量子计算？"},
    ],
)
print(result["choices"][0]["message"]["content"])
```

### `ask(question, system_prompt, **kwargs)` — 便捷封装

传入问题字符串，直接返回模型回复文本。

```python
from llm_client import ask

# 默认 system prompt
answer = ask("什么是量子计算？")

# 自定义 system prompt
answer = ask("总结这段文本", system_prompt="你是一个中文助手")
```

### 多轮对话

```python
from llm_client import chat

result = chat([
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Hello"},
    {"role": "assistant", "content": "Hi! How can I help?"},
    {"role": "user", "content": "Tell me about DNA."},
])

print(result["choices"][0]["message"]["content"])
```

## 注意事项

- 该网关的 Anthropic 模型**不支持** `temperature` 和 `stream` 参数，传入会返回 400 错误。
- `max_tokens` 为必填参数，控制回复长度上限。默认值 `9000`（约 3000 个中文字），中文大约 1 字 ≈ 2-3 tokens。
- 请求超时设置为 120 秒。
- `PORTKEY_API_KEY` 未设置时会抛出 `EnvironmentError`。

## 返回格式

```json
{
  "id": "1778244623067",
  "object": "chat.completion",
  "model": "eu.anthropic.claude-opus-4-7",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "模型回复内容..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 33,
    "completion_tokens": 1097,
    "total_tokens": 1140
  }
}
```
