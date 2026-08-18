"""送货单版式 JSON 模板存储/匹配/学习测试（不依赖真实 DB）。"""
import json

from app.services.ocr.delivery_template import (
    TEMPLATE_KEY,
    _blob,
    learn_template,
    load_templates,
    match_template,
    save_templates,
)


class _Cfg:
    def __init__(self, value):
        self.config_key = TEMPLATE_KEY
        self.config_value = value
        self.remark = ""


class _FakeDB:
    def __init__(self, templates=None):
        self.templates = templates or []
        self.added = []
        self.commits = 0

    def scalar(self, stmt):
        if self.added:
            return self.added[0]
        if not self.templates:
            return None
        return _Cfg(json.dumps(self.templates, ensure_ascii=False))

    def add(self, obj):
        self.added.append(obj)

    def commit(self):
        self.commits += 1


def test_blob_ignores_whitespace():
    assert _blob(["物 料 编码", "含税单价"]) == "物料编码含税单价"


def test_match_template_hits_anchors():
    db = _FakeDB([{"id": "t1", "name": "采购订单", "anchors": ["物料编码", "含税单价"]}])
    tpl = match_template(db, ["行号 物料编码 含税单价", "114050000000310"])
    assert tpl and tpl["id"] == "t1"


def test_match_template_miss():
    db = _FakeDB([{"id": "t1", "name": "采购订单", "anchors": ["物料编码", "含税单价"]}])
    assert match_template(db, ["货物名称 数量单价"]) is None


def test_learn_template_saves_new():
    db = _FakeDB([])
    tpl = learn_template(db, ["货物名称 数量单价 金额 备注"], {"items": [{"product_name": "x"}]})
    assert tpl is not None
    assert db.commits == 1
    assert len(tpl["anchors"]) >= 3
    # 重复学习不重复保存
    db2 = _FakeDB(load_templates(db))
    tpl2 = learn_template(db2, ["货物名称 数量单价 金额 备注"], {"items": [{"product_name": "x"}]})
    assert tpl2["id"] == tpl["id"]
    assert db2.commits == 0


def test_save_templates_roundtrip():
    db = _FakeDB([])
    save_templates(db, [{"id": "t", "name": "n", "anchors": ["a"]}])
    assert db.commits == 1
    db2 = _FakeDB(load_templates(db))
    assert load_templates(db2) == [{"id": "t", "name": "n", "anchors": ["a"]}]
