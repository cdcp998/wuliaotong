import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { App, Button, Divider, Form, Input, InputNumber, Modal, Select, Space } from "antd";
import { EditOutlined, PlusOutlined } from "@ant-design/icons";

import { baseApi, type CategoryNode } from "@wlt/shared";

/** 分类树拍平（保留完整节点，parent_id 用于上级查询）。 */
function flattenCats(nodes: CategoryNode[]): CategoryNode[] {
  const out: CategoryNode[] = [];
  for (const n of nodes) {
    out.push(n);
    if (n.children?.length) out.push(...flattenCats(n.children));
  }
  return out;
}

/** 分类树转父分类候选（新增/编辑分类弹窗用：顶级 + 一级 + 二级，三级下不能再建）。 */
function parentOptions(nodes: CategoryNode[]): { value: number; label: string }[] {
  const out = [{ value: 0, label: "顶级分类" }];
  for (const n of nodes) {
    out.push({ value: n.id, label: n.name });
    n.children?.forEach((c) => out.push({ value: c.id, label: `${n.name}/${c.name}` }));
  }
  return out;
}

/** 材料挂载候选（三级体系）：二级 + 三级分类，显示完整路径；顶级分类只作分组不可挂材料。 */
function attachOptions(nodes: CategoryNode[]): { value: number; label: string }[] {
  const out: { value: number; label: string }[] = [];
  for (const n of nodes) {
    n.children?.forEach((c) => {
      out.push({ value: c.id, label: `${n.name}/${c.name}` });
      c.children?.forEach((g) => out.push({ value: g.id, label: `${n.name}/${c.name}/${g.name}` }));
    });
  }
  return out;
}

interface CategorySelectProps {
  /** 当前选中分类 id（undefined = 未选择）。 */
  value?: number;
  /** 选择/新增/编辑后回调：id 为空表示清空，name 为对应分类名（供行内回显/提交）。 */
  onChange?: (id: number | undefined, name: string) => void;
  /** 系统分类树（父组件加载并共享给各行；新增/编辑后请通过 onReload 刷新）。 */
  tree: CategoryNode[];
  /** 新增/编辑分类成功后通知父组件刷新分类树。 */
  onReload?: () => void;
  placeholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
  style?: CSSProperties;
}

/**
 * 分类选择（入库/送货单等行内场景）：下拉选择已有分类，下拉底部可「新增分类 / 编辑分类」，
 * 保存后自动把新分类选中并回调 onChange(id, name)。分类树由父组件统一加载（页面级共享）。
 */
export function CategorySelect({ value, onChange, tree, onReload, placeholder = "选择分类", allowClear = true, disabled, style }: CategorySelectProps) {
  const { message } = App.useApp();
  const catFlat = useMemo(() => flattenCats(tree), [tree]);
  const parentOpts = useMemo(() => parentOptions(tree), [tree]);
  // 编辑弹窗的「选择要编辑的分类」候选：全部节点（顶级 + 二级 + 三级，显示路径）
  const editOpts = useMemo(
    () => [
      ...parentOpts.filter((o) => o.value !== 0),
      ...tree.flatMap((n) =>
        (n.children ?? []).flatMap((c) => [
          { value: c.id, label: `${n.name}/${c.name}` },
          ...(c.children ?? []).map((g) => ({ value: g.id, label: `${n.name}/${c.name}/${g.name}` })),
        ])
      ),
    ],
    [parentOpts, tree]
  );
  // 挂载候选仅二级/三级分类；当前值若是顶级分类（历史数据）仍回显，提醒改挂
  const attachOpts = useMemo(() => {
    const base = attachOptions(tree);
    const cur = catFlat.find((c) => c.id === value);
    if (cur && cur.parent_id === 0 && !base.some((o) => o.value === cur.id)) {
      return [{ value: cur.id, label: `${cur.name}（顶级，请改挂二级/三级）` }, ...base];
    }
    return base;
  }, [tree, value, catFlat]);
  // 分类新增/编辑弹窗
  const [catOpen, setCatOpen] = useState(false);
  const [catIsEdit, setCatIsEdit] = useState(false);
  const [catTarget, setCatTarget] = useState<CategoryNode | null>(null);
  const [catSaving, setCatSaving] = useState(false);
  const [catForm] = Form.useForm();

  function openCatCreate() {
    setCatIsEdit(false);
    setCatTarget(null);
    setCatOpen(true);
  }

  function openCatEdit() {
    // 缺省编辑当前选中的分类；未选择时从已有分类中挑第一个
    setCatIsEdit(true);
    setCatTarget(catFlat.find((c) => c.id === value) ?? catFlat[0] ?? null);
    setCatOpen(true);
  }

  async function saveCat() {
    let v: { parent_id?: number; name: string; sort?: number };
    try {
      v = await catForm.validateFields();
    } catch {
      return; // 表单校验失败（错误已内联展示）
    }
    const body = { parent_id: v.parent_id ?? 0, name: v.name.trim(), sort: v.sort ?? 0 };
    setCatSaving(true);
    try {
      if (catIsEdit && catTarget) {
        await baseApi.updateCategory(catTarget.id, body);
        message.success("分类已更新");
        setCatOpen(false);
        onReload?.();
        // 编辑的正是当前行选中的分类时同步名称；否则不改变当前选择
        if (value === catTarget.id) onChange?.(catTarget.id, v.name.trim());
      } else {
        const created = await baseApi.createCategory(body);
        // 规则：材料只能挂二级分类；新建的顶级分类不自动挂到当前行，需先建其子分类
        message.success(created.parent_id !== 0 ? "分类已创建" : "分类已创建（顶级分类仅作分组，请再创建其子分类后挂材料）");
        setCatOpen(false);
        onReload?.();
        if (created.parent_id !== 0) onChange?.(created.id, created.name); // 新二级分类自动选中给当前行
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setCatSaving(false);
    }
  }

  return (
    <>
      <Select
        style={style}
        showSearch
        allowClear={allowClear}
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        options={attachOpts}
        optionFilterProp="label"
        onChange={(v) => {
          const c = catFlat.find((x) => x.id === v);
          onChange?.(v, c?.name ?? "");
        }}
        popupRender={(menu) => (
          <>
            {menu}
            <Divider style={{ margin: "8px 0" }} />
            <Space style={{ padding: "0 8px 8px" }}>
              <Button type="link" size="small" icon={<PlusOutlined />} onClick={openCatCreate}>
                新增分类
              </Button>
              <Button type="link" size="small" icon={<EditOutlined />} onClick={openCatEdit}>
                编辑分类
              </Button>
            </Space>
          </>
        )}
      />
      <Modal
        title={catIsEdit ? `编辑分类：${catTarget?.name ?? ""}` : "新增分类"}
        open={catOpen}
        onOk={() => void saveCat()}
        okText="保存"
        confirmLoading={catSaving}
        onCancel={() => setCatOpen(false)}
        width={420}
        destroyOnHidden
        forceRender
        afterOpenChange={(o) => {
          if (!o) return;
          if (catIsEdit && catTarget) {
            catForm.setFieldsValue({ name: catTarget.name, parent_id: catTarget.parent_id, sort: catTarget.sort ?? 0 });
          } else {
            catForm.resetFields();
            catForm.setFieldsValue({ parent_id: 0, sort: 0 });
          }
        }}
      >
        <Form form={catForm} layout="vertical">
          {catIsEdit && (
            <Form.Item label="选择分类" required>
              <Select
                placeholder="选择要编辑的分类"
                options={editOpts}
                value={catTarget?.id}
                onChange={(id) => {
                  const c = catFlat.find((x) => x.id === id);
                  if (!c) return;
                  setCatTarget(c);
                  catForm.setFieldsValue({ name: c.name, parent_id: c.parent_id, sort: c.sort ?? 0 });
                }}
              />
            </Form.Item>
          )}
          <Form.Item name="name" label="分类名称" rules={[{ required: true, message: "请输入分类名称" }, { max: 50, message: "不超过 50 字" }]}>
            <Input placeholder="如：轴承类 / 五金件" maxLength={50} />
          </Form.Item>
          <Form.Item name="parent_id" label="父分类" rules={[{ required: true, message: "请选择父分类" }]}>
            <Select options={catIsEdit && catTarget ? parentOpts.filter((o) => o.value !== catTarget.id) : parentOpts} />
          </Form.Item>
          <Form.Item name="sort" label="排序（小在前）">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
