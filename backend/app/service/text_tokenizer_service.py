"""为规则重排提供统一的中文词语及英文技术词项提取能力。

复用参考项目的 huqie.txt 作为扩展词典。
当前使用 Jieba 分词，不等同于原项目 RagTokenizer 的完整实现。
"""

import logging
import re
import unicodedata
from collections.abc import Iterator
from pathlib import Path
from threading import Lock

import jieba

from exceptions.search import SearchIndexError


logger = logging.getLogger(__name__)

BACKEND_ROOT = Path(__file__).resolve().parents[2]
DICTIONARY_ROOT = BACKEND_ROOT / "resources" / "tokenizer"

ORIGINAL_DICT_PATH = DICTIONARY_ROOT / "huqie.txt"
USER_DICT_PATH = DICTIONARY_ROOT / "user_dict.txt"
CACHE_DIR = BACKEND_ROOT / ".cache" / "tokenizer"

# 英文技术标识保持整体，连续中文交给分词器处理。
TOKEN_PATTERN = re.compile(
    r"[a-z0-9]+(?:[-_.][a-z0-9]+)*|[\u3400-\u9fff]+",
    re.IGNORECASE,
)
CHINESE_PATTERN = re.compile(r"[\u3400-\u9fff]+")

# 仅过滤完整词项，不从其他词语内部删除字符。
STOP_WORDS = frozenset({
    "的", "了", "是", "在", "和", "与", "及",
    "请问", "什么", "哪些", "如何", "怎么", "吗",
})

_tokenizer: jieba.Tokenizer | None = None
_TOKENIZER_LOCK = Lock()


def _dictionary_entries(path: Path) -> Iterator[str]:
    """读取词典并输出规范化词条，跳过空白词条。

    只使用词语和整数词频，词性暂不参与当前规则评分。
    使用明确的空格分隔，避免特殊空白词条被误解析为有效词语。
    """
    with path.open("r", encoding="utf-8-sig") as stream:
        for number, line in enumerate(stream, start=1):
            parts = line.rstrip("\r\n").split(" ")

            word = unicodedata.normalize(
                "NFKC",
                parts[0],
            ).casefold()

            if not word.strip() or any(
                char.isspace() for char in word
            ):
                continue

            if len(parts) < 2:
                raise ValueError(f"词典第 {number} 行缺少词频")

            frequency = int(parts[1])

            if frequency <= 0:
                raise ValueError(
                    f"词典第 {number} 行的词频必须为正整数"
                )

            yield f"{word} {frequency}\n"


def _get_tokenizer() -> jieba.Tokenizer:
    """延迟初始化并复用分词器，避免并发请求重复加载词典。

    所有词典在发布实例前加载完成，后续请求只读取该实例。
    修改词典后需要重启后端，使新词条生效。
    """
    global _tokenizer

    with _TOKENIZER_LOCK:
        if _tokenizer is not None:
            return _tokenizer

        if not ORIGINAL_DICT_PATH.is_file():
            raise SearchIndexError(
                "缺少中文分词词典，请检查 "
                "backend/resources/tokenizer/huqie.txt"
            )

        try:
            CACHE_DIR.mkdir(parents=True, exist_ok=True)

            tokenizer = jieba.Tokenizer()
            tokenizer.tmp_dir = str(CACHE_DIR)

            tokenizer.load_userdict(
                _dictionary_entries(ORIGINAL_DICT_PATH)
            )

            if USER_DICT_PATH.is_file():
                tokenizer.load_userdict(
                    _dictionary_entries(USER_DICT_PATH)
                )

        except (OSError, UnicodeError, ValueError) as exc:
            logger.error(
                "中文分词器初始化失败，error_type=%s",
                type(exc).__name__,
            )
            raise SearchIndexError(
                "中文分词器初始化失败，请检查词典文件和格式"
            ) from exc

        _tokenizer = tokenizer
        return tokenizer


def extract_terms(text: str) -> set[str]:
    """提取去重词项，供问题和候选片段使用同一套匹配规则。

    Args:
        text: 问题或候选片段正文。

    Returns:
        规范化并去除停用词后的词项集合。

    Notes:
        NFKC 统一常见全角字符，casefold 统一英文大小写。
        中文使用词典分词；英文保留 YOLOv11、ResNet-50 等标识。
        不修改原文，也不改变引用位置。
        未登录词仍可能被拆成单字，可通过领域词典补充。
    """
    normalized = unicodedata.normalize("NFKC", text).casefold()
    terms: set[str] = set()

    for match in TOKEN_PATTERN.finditer(normalized):
        part = match.group()

        if CHINESE_PATTERN.fullmatch(part):
            words = _get_tokenizer().cut(part, HMM=False)
        else:
            words = (part,)

        for word in words:
            if word and word not in STOP_WORDS:
                terms.add(word)

    return terms