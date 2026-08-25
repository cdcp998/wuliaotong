import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Alert, App, Button, Form, Input, InputNumber } from "antd";
import { CheckOutlined } from "@ant-design/icons";

import { initApi, useAuthStore } from "@wlt/shared";

/** 安装向导五步（《前端设计.md》§2.2 功能契约不变）：系统信息 → 数据库 → Redis → 管理员账号 → 联系方式。
 *  视觉按设计页 55 同步：#F2F5FB 页底 + 顶部 Logo 条 + 860 居中白卡（r20 柔投影）+ 胶囊步骤条。 */
const STEP_TITLES = ["系统信息", "数据库配置", "Redis 配置", "管理员账号", "联系方式"];

interface InitForm {
  site_name: string;
  db_host: string;
  db_port: number;
  db_user: string;
  db_password: string;
  db_name: string;
  redis_host: string;
  redis_port: number;
  redis_password: string;
  redis_db: number;
  admin_username: string;
  admin_password: string;
  confirm_password: string;
  contact_phone?: string;
}

/** 初始化安装页（《前端设计.md》§2.2）：系统未初始化时强制展示，五步引导 →
 * POST /init（自动验证数据库/Redis 连接并保存配置到 backend/.env）→ 自动登录进入主页面；
 * 已初始化访问自动跳回登录/主页。 */
export function InitPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const fetchMe = useAuthStore((s) => s.fetchMe);
  const [form] = Form.useForm<InitForm>();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // 已初始化（含已登录会话）访问本页 → 回登录/主页；未初始化则预填系统名称
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const st = await initApi.status();
        if (!alive) return;
        if (st.initialized) {
          fetchMe()
            .then(() => navigate("/app", { replace: true }))
            .catch(() => navigate("/login", { replace: true }));
          return;
        }
        if (st.site_name) form.setFieldsValue({ site_name: st.site_name });
      } catch {
        /* 状态接口异常不阻塞表单填写 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [form, navigate, fetchMe]);

  async function next() {
    try {
      if (step === 0) await form.validateFields(["site_name"]);
      if (step === 1) await form.validateFields(["db_host", "db_port", "db_user", "db_password", "db_name"]);
      if (step === 2) await form.validateFields(["redis_host", "redis_port", "redis_db"]);
      if (step === 3) await form.validateFields(["admin_username", "admin_password", "confirm_password"]);
      setStep(step + 1);
    } catch {
      /* 校验失败：错误提示由 Form.Item 就地展示，不切换步骤（避免 unhandled rejection） */
    }
  }

  async function onSubmit() {
    try {
      await form.validateFields();
    } catch {
      return; // 校验失败：错误提示由 Form.Item 就地展示
    }
    const v = form.getFieldsValue();
    setSubmitting(true);
    try {
      const data = await initApi.submit({
        site_name: v.site_name.trim(),
        admin_username: v.admin_username.trim(),
        admin_password: v.admin_password,
        contact_phone: v.contact_phone?.trim() || undefined,
        db_host: v.db_host.trim(),
        db_port: v.db_port,
        db_user: v.db_user.trim(),
        db_password: v.db_password,
        db_name: v.db_name.trim(),
        redis_host: v.redis_host.trim(),
        redis_port: v.redis_port,
        redis_password: v.redis_password,
        redis_db: v.redis_db,
      });
      if (data.redis_connected === false) {
        message.warning(
          `初始化完成，但 Redis 连接失败（${data.redis_warning ?? "未知原因"}），缓存将降级为直查数据库；数据库连接已切换，无需重启。正在进入系统…`
        );
      } else {
        message.success("初始化完成！数据库连接已即时切换至新配置，无需重启后端。正在进入系统…");
      }
      await login(v.admin_username.trim(), v.admin_password);
      navigate("/app", { replace: true });
    } catch (err) {
      message.error(err instanceof Error ? err.message : "初始化失败");
    } finally {
      setSubmitting(false);
    }
  }

  /** 胶囊步骤条（设计页 55）：已完成=浅蓝底✓ / 当前=品牌蓝白字 / 未到=浅灰底灰字。 */
  const stepState = (i: number): "done" | "active" | "idle" => (i < step ? "done" : i === step ? "active" : "idle");
  const pillStyle = (state: "done" | "active" | "idle"): React.CSSProperties =>
    state === "active"
      ? { background: "#5B7FFF", color: "#FFFFFF", fontWeight: 600 }
      : state === "done"
        ? { background: "#EAEFFF", color: "#3B5BDB", fontWeight: 600 }
        : { background: "#F6F8FE", color: "#5B6478", fontWeight: 500 };

  return (
    <div style={{ minHeight: "100dvh", background: "#F2F5FB", display: "flex", flexDirection: "column", padding: "28px 48px" }}>
      {/* 顶部 Logo 条（设计页 55：品牌蓝方块 Logo + 名称/副标，左上） */}
      <header style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            background: "#5B7FFF",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 20,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          物
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#1E2433", lineHeight: 1.3 }}>物料通 · 初始化安装</div>
          <div style={{ fontSize: 12, color: "#8A93A8" }}>首次部署引导 · 5 分钟完成</div>
        </div>
      </header>

      {/* 居中主卡（设计页 55：860 宽白卡 r20 p28/32 gap16 柔投影） */}
      <main style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 0" }}>
        <div
          style={{
            width: 860,
            maxWidth: "100%",
            background: "#FFFFFF",
            borderRadius: 20,
            padding: "28px 32px",
            boxShadow: "0 12px 40px rgba(30,36,51,0.08)",
            border: "1px solid #EFF3FC",
          }}
        >
          {/* 胶囊步骤条 */}
          <div style={{ display: "flex", gap: 8, marginBottom: 22 }}>
            {STEP_TITLES.map((title, i) => {
              const state = stepState(i);
              return (
                <div
                  key={title}
                  style={{
                    flex: 1,
                    height: 34,
                    borderRadius: 10,
                    padding: "8px 12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    fontSize: 12.5,
                    whiteSpace: "nowrap",
                    transition: "all .2s ease",
                    ...pillStyle(state),
                  }}
                >
                  {state === "done" ? <CheckOutlined style={{ fontSize: 11 }} /> : <span>{i + 1}</span>}
                  <span>{title}</span>
                </div>
              );
            })}
          </div>

          <Form
            form={form}
            layout="vertical"
            initialValues={{
              site_name: "物料通管理系统",
              db_host: "127.0.0.1",
              db_port: 3306,
              db_user: "root",
              db_name: "wuliaotong",
              redis_host: "127.0.0.1",
              redis_port: 6379,
              redis_db: 0,
              admin_username: "admin",
            }}
          >
            {/* 五步字段常驻挂载（display 切换）：避免 antd v6 卸载字段丢失值导致提交取值 undefined */}
            <div style={{ display: step === 0 ? "block" : "none" }}>
              <Form.Item
                name="site_name"
                label="系统名称"
                rules={[{ required: true, message: "请输入系统名称" }, { max: 50, message: "最多 50 个字符" }]}
              >
                <Input placeholder="如：XX 公司物料管理系统" size="large" autoFocus={step === 0} />
              </Form.Item>
            </div>
            <div style={{ display: step === 1 ? "block" : "none" }}>
              <Alert
                type="info"
                showIcon
                title="提交时将自动验证数据库连接：目标库不存在会自动创建并导入表结构（backend/sql/init.sql），已存在的库仅验证连接、不会改动表结构。"
                style={{ marginBottom: 12 }}
              />
              <Form.Item name="db_host" label="数据库地址" rules={[{ required: true, message: "请输入数据库地址" }]}>
                <Input placeholder="如 127.0.0.1" size="large" autoFocus={step === 1} />
              </Form.Item>
              <div style={{ display: "flex", gap: 12 }}>
                <Form.Item
                  name="db_port"
                  label="端口"
                  rules={[{ required: true, message: "请输入端口" }]}
                  style={{ width: 140 }}
                >
                  <InputNumber min={1} max={65535} size="large" style={{ width: "100%" }} />
                </Form.Item>
                <Form.Item name="db_name" label="数据库名" rules={[{ required: true, message: "请输入数据库名" }, { pattern: /^[A-Za-z0-9_]+$/, message: "仅支持字母/数字/下划线" }]} style={{ flex: 1 }}>
                  <Input placeholder="如 wuliaotong" size="large" />
                </Form.Item>
              </div>
              <Form.Item name="db_user" label="数据库用户名" rules={[{ required: true, message: "请输入数据库用户名" }]}>
                <Input placeholder="如 root" size="large" />
              </Form.Item>
              <Form.Item name="db_password" label="数据库密码" rules={[{ required: true, message: "请输入数据库密码" }]}>
                <Input.Password placeholder="数据库密码" size="large" />
              </Form.Item>
            </div>
            <div style={{ display: step === 2 ? "block" : "none" }}>
              <Alert
                type="info"
                showIcon
                title="Redis 为缓存加速层：连接失败不会阻止安装，系统将自动降级为直查数据库。"
                style={{ marginBottom: 12 }}
              />
              <Form.Item name="redis_host" label="Redis 地址" rules={[{ required: true, message: "请输入 Redis 地址" }]}>
                <Input placeholder="如 127.0.0.1" size="large" autoFocus={step === 2} />
              </Form.Item>
              <div style={{ display: "flex", gap: 12 }}>
                <Form.Item
                  name="redis_port"
                  label="端口"
                  rules={[{ required: true, message: "请输入端口" }]}
                  style={{ width: 140 }}
                >
                  <InputNumber min={1} max={65535} size="large" style={{ width: "100%" }} />
                </Form.Item>
                <Form.Item name="redis_db" label="数据库编号" rules={[{ required: true, message: "请输入库编号" }]} style={{ width: 140 }}>
                  <InputNumber min={0} max={15} size="large" style={{ width: "100%" }} />
                </Form.Item>
              </div>
              <Form.Item name="redis_password" label="Redis 密码（无密码留空）">
                <Input.Password placeholder="无密码可留空" size="large" />
              </Form.Item>
            </div>
            <div style={{ display: step === 3 ? "block" : "none" }}>
              <Form.Item
                name="admin_username"
                label="管理员账号"
                rules={[
                  { required: true, message: "请输入管理员账号" },
                  { min: 2, message: "至少 2 个字符" },
                  { pattern: /^[a-zA-Z0-9_-]+$/, message: "仅支持字母/数字/下划线/中划线" },
                ]}
              >
                <Input placeholder="字母/数字/下划线" size="large" autoFocus={step === 3} />
              </Form.Item>
              <Form.Item
                name="admin_password"
                label="管理员密码"
                rules={[{ required: true, message: "请输入管理员密码" }, { min: 6, message: "至少 6 位" }]}
              >
                <Input.Password placeholder="至少 6 位" size="large" />
              </Form.Item>
              <Form.Item
                name="confirm_password"
                label="确认密码"
                dependencies={["admin_password"]}
                rules={[
                  { required: true, message: "请再次输入密码" },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue("admin_password") === value) return Promise.resolve();
                      return Promise.reject(new Error("两次输入的密码不一致"));
                    },
                  }),
                ]}
              >
                <Input.Password placeholder="再次输入管理员密码" size="large" />
              </Form.Item>
            </div>
            <div style={{ display: step === 4 ? "block" : "none" }}>
              <Form.Item name="contact_phone" label="管理员联系电话（可选）" rules={[{ max: 20, message: "最多 20 个字符" }]}>
                <Input placeholder="用于「电话找回密码」时展示" size="large" autoFocus={step === 4} />
              </Form.Item>
              <Alert
                type="info"
                showIcon
                title="提交后将验证数据库/Redis 连接、保存配置并完成初始化，系统即刻可用（数据库连接即时生效，无需重启）。"
                style={{ marginBottom: 8 }}
              />
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
              {step > 0 && (
                <Button size="large" style={{ width: 110 }} onClick={() => setStep(step - 1)}>
                  上一步
                </Button>
              )}
              {step < 4 ? (
                <Button type="primary" size="large" block onClick={() => void next()}>
                  下一步
                </Button>
              ) : (
                <Button type="primary" size="large" block loading={submitting} onClick={() => void onSubmit()}>
                  完成安装并进入系统
                </Button>
              )}
            </div>
          </Form>
        </div>
      </main>
    </div>
  );
}
