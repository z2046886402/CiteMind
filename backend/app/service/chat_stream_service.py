"""提供对话模型的流式文本调用能力。

本模块只负责模型通信，不承担身份认证、文献检索和数据库保存。
调用方必须在完整消费生成器且未发生异常后，才将回答视为生成完成。
"""

import json
import logging
import os
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from openai import APIError, OpenAI

from exceptions.chat import ChatServiceError

logger = logging.getLogger(__name__)


def stream_chat_model(
    system_prompt: str,
    payload: dict[str, Any],
) -> Iterator[str]:
    """逐段返回模型生成的文本，并检查最终完成状态。

    Args:
        system_prompt: 控制模型行为的系统提示词。
        payload: 可序列化为 JSON 的用户问题及上下文数据。

    Yields:
        模型本次新增的文本。片段长度由服务端决定，
        一个片段可能包含一个字，也可能包含多个字。

    Raises:
        ChatServiceError: 配置缺失、模型通信失败、输出为空，
            或生成过程没有正常结束。

    Notes:
        已经产出的片段属于临时结果，后续仍可能发生异常。
        本函数不记录提示词、参考资料及模型回答正文。
        调用方提前结束消费时，应关闭生成器以释放连接。
    """
    env_path = Path(__file__).resolve().parents[2] / ".env"
    load_dotenv(env_path)

    api_key = os.getenv("DASHSCOPE_API_KEY", "").strip()
    base_url = os.getenv("DASHSCOPE_BASE_URL", "").strip()
    model = os.getenv("CHAT_MODEL", "").strip()

    if not api_key or not base_url or not model:
        raise ChatServiceError(
            "请配置百炼凭证、接口地址及 CHAT_MODEL"
        )

    # 在请求发出前完成序列化，避免因参数格式错误产生无效请求。
    user_content = json.dumps(payload, ensure_ascii=False)

    finish_reason: str | None = None
    has_content = False

    try:
        with OpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=120.0,
            max_retries=0,
        ) as client:
            with client.chat.completions.create(
                model=model,
                messages=[
                    {
                        "role": "system",
                        "content": system_prompt,
                    },
                    {
                        "role": "user",
                        "content": user_content,
                    },
                ],
                stream=True,
                temperature=0.2,
                max_tokens=2048,
                response_format={"type": "text"},
                extra_body={"enable_thinking": False},
            ) as stream:
                for chunk in stream:
                    # 部分统计信息包没有 choices，不包含正文。
                    if not chunk.choices:
                        continue

                    choice = chunk.choices[0]

                    if choice.finish_reason is not None:
                        finish_reason = choice.finish_reason

                    content = choice.delta.content

                    # 角色信息包和结束包可能没有文本。
                    if content:
                        if content.strip():
                            has_content = True

                        # 保留原始空白，避免破坏词语、换行及引用标记。
                        yield content

    except APIError as exc:
        logger.error(
            "流式模型调用失败，error_type=%s，status_code=%s",
            type(exc).__name__,
            getattr(exc, "status_code", None),
        )
        raise ChatServiceError(
            "流式模型调用失败，请检查模型权限、配置、网络或额度"
        ) from exc

    # 连接关闭并不一定代表生成成功，例如输出被长度限制截断。
    if finish_reason != "stop":
        raise ChatServiceError(
            "模型输出未正常完成，已显示的内容属于不完整回答"
        )

    if not has_content:
        raise ChatServiceError("模型返回了空内容")