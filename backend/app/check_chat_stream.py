"""通过终端验证模型流式输出。

运行本脚本会发起一次真实模型请求，使用 backend/.env 中的配置。
本脚本不读取文献、不创建会话，也不保存聊天记录。
"""

from contextlib import closing

from exceptions.chat import ChatServiceError
from service.chat_stream_service import stream_chat_model


def main() -> int:
    """显示模型增量文本，并用退出码区分成功与失败。"""
    print("正在请求模型，收到文本后会立即显示：\n", flush=True)

    try:
        # 提前退出或发生异常时，确保关闭生成器及其内部连接。
        with closing(
            stream_chat_model(
                system_prompt="你是一位中文教学助手，请简洁回答。",
                payload={
                    "question": "请用三句话通俗解释文献 RAG 的作用。",
                },
            )
        ) as fragments:
            for fragment in fragments:
                # flush=True 让终端立即显示，避免输出缓冲造成等待。
                print(fragment, end="", flush=True)

    except ChatServiceError as exc:
        print(f"\n\n验证失败：{exc}")
        return 1
    except KeyboardInterrupt:
        print("\n\n已停止验证。")
        return 130

    print("\n\n流式输出验证成功。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())