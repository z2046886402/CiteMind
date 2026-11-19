"""定义文献搜索索引操作的业务异常。"""


class SearchIndexError(Exception):
    """索引写入、清理或结果检查未完成。"""