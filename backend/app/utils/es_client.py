"""读取 Elasticsearch 配置并创建客户端。"""

import os
import re
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv
from elasticsearch import Elasticsearch

ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
load_dotenv(ENV_PATH)


def get_chunk_index_name() -> str:
    """读取具体索引名称，禁止别名表达式和通配符。"""
    index_name = os.getenv("ES_INDEX", "citemind_chunks_v1").strip()

    if not re.fullmatch(r"[a-z][a-z0-9_-]{0,99}", index_name):
        raise ValueError("ES_INDEX 必须是以小写字母开头的合法索引名称")

    return index_name


def create_es_client() -> Elasticsearch:
    """创建带认证的 Elasticsearch 客户端。

    Returns:
        由调用方负责关闭的客户端。

    Raises:
        ValueError: 必要配置缺失或连接地址不符合要求。

    Notes:
        当前 HTTP 连接仅允许本机开发使用。
        HTTPS 连接通过 ES_CA_CERT 指定可信 CA 证书。
    """
    host = os.getenv("ES_HOST", "").strip()
    username = os.getenv("ES_USERNAME", "").strip()
    password = os.getenv("ES_PASSWORD", "")

    if not host or not username or not password:
        raise ValueError("请配置 ES_HOST、ES_USERNAME 和 ES_PASSWORD")

    address = urlparse(host)

    if address.scheme not in {"http", "https"} or not address.hostname:
        raise ValueError("ES_HOST 必须是有效的 HTTP 或 HTTPS 地址")

    if address.username is not None or address.password is not None:
        raise ValueError("请将认证信息放在独立配置中，不要写入 ES_HOST")

    options = {}

    if address.scheme == "http":
        if address.hostname not in {"localhost", "127.0.0.1", "::1"}:
            raise ValueError("HTTP 连接仅允许访问本机 Elasticsearch")
    else:
        certificate = os.getenv("ES_CA_CERT", "").strip()

        if not certificate or not Path(certificate).is_file():
            raise ValueError("HTTPS 连接需要有效的 ES_CA_CERT 证书文件")

        options["ca_certs"] = certificate

    return Elasticsearch(
        hosts=[host],
        basic_auth=(username, password),
        request_timeout=30,
        max_retries=0,
        **options,
    )