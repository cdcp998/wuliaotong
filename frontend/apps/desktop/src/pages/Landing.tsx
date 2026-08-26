import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { DesktopOutlined, MobileOutlined, RightOutlined } from "@ant-design/icons";

import { detectDevice, getEntryPreference, initApi, otherEndUrl, setEntryPreference } from "@wlt/shared";

/** 入口页（设计页 56「入口选择」）：未初始化强制跳初始化安装页；已初始化时展示
 *  双端选择卡片（OP 设计），3 秒倒计时后按设备类型自动跳转；用户手动点击立即跳转并记住偏好。
 *
 * 优先级：初始化状态 > 用户手动选择（localStorage wlt_entry）> 展示选择页 + 3s 自动跳转；
 * 用户选择一端后不再自动跳转，避免手机点"电脑版入口"又被弹回手机版。
 *
 * 注意：这里不调用 fetchMe() 探测会话——共享 http 客户端对 401 会整页硬跳登录页，
 * 会抢在选择页渲染前发生。已登录用户经由倒计时落地 /login 后，登录页自身的
 * fetchMe 会自动送进 /app，行为等价且不会闪跳。
 * 防循环保险：15 秒窗口内自动跳转 ≥3 次（如「已登录但无当前页权限」被 RequireAuth
 * 弹回入口）则停止自动跳转，停留在选择页由用户手动决定。
 */

const AUTO_SECONDS = 3;

/** 记录一次自动跳转，返回 15 秒窗口内的累计次数。 */
function pushAutoJump(): number {
  try {
    const key = "wlt_entry_autojumps";
    const prev: number[] = JSON.parse(sessionStorage.getItem(key) ?? "[]").filter((t: number) => Date.now() - t < 15000);
    prev.push(Date.now());
    sessionStorage.setItem(key, JSON.stringify(prev));
    return prev.length;
  } catch {
    return 1;
  }
}

export function LandingPage() {
  const navigate = useNavigate();

  /** null=尚未判定（保持旧版瞬时跳转分支）；否则展示选择页并倒计时 */
  const [autoTarget, setAutoTarget] = useState<"desktop" | "mobile" | null>(null);
  const [countdown, setCountdown] = useState(AUTO_SECONDS);
  /** 倒计时终止原因：手动取消 / 循环保护；null=仍在倒计时 */
  const [stopped, setStopped] = useState<"manual" | "loop" | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const jump = useCallback(
    (target: "desktop" | "mobile") => {
      setEntryPreference(target);
      if (target === "mobile") window.location.replace(otherEndUrl("mobile"));
      else navigate("/login", { replace: true });
    },
    [navigate]
  );

  useEffect(() => {
    let alive = true;
    // 先查初始化状态：未初始化 → 初始化安装页；状态接口异常不阻塞入口
    initApi
      .status()
      .then((st) => {
        if (alive && !st.initialized) {
          navigate("/init", { replace: true });
          return false;
        }
        return true;
      })
      .catch(() => true)
      .then((proceed) => {
        if (!alive || !proceed) return;
        const pref = getEntryPreference();
        if (pref === "mobile") {
          window.location.replace(otherEndUrl("mobile"));
          return;
        }
        if (pref === "desktop") {
          navigate("/login", { replace: true });
          return;
        }
        // 展示 OP 选择页，3 秒后按设备类型自动进入
        const kind = detectDevice();
        setAutoTarget(kind === "mobile" || kind === "tablet" ? "mobile" : "desktop");
        setCountdown(AUTO_SECONDS);
      });
    return () => {
      alive = false;
    };
  }, [navigate]);

  // 倒计时：每秒 -1，归零自动跳转；手动选择/取消即停止
  useEffect(() => {
    if (!autoTarget || stopped) return;
    if (countdown <= 0) {
      // 循环保护：短时间内反复被弹回入口时不再自动跳转
      if (pushAutoJump() > 2) {
        setStopped("loop");
        return;
      }
      jump(autoTarget);
      return;
    }
    timerRef.current = setInterval(() => setCountdown((n) => n - 1), 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [autoTarget, countdown, stopped, jump]);

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setStopped("manual");
  };

  const pick = (target: "desktop" | "mobile") => {
    stopTimer();
    jump(target);
  };

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "#F2F5FB",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        gap: 10,
      }}
    >
      {/* Logo（设计页 56：品牌蓝方块 + 名称/副标） */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
          }}
        >
          物
        </div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#1E2433", lineHeight: 1.25 }}>物料通</div>
          <div style={{ fontSize: 12, color: "#6A748A" }}>企业物资管理平台</div>
        </div>
      </div>

      <h2 style={{ margin: "26px 0 0", fontSize: 16, fontWeight: 600, color: "#1E2433" }}>选择您要使用的终端</h2>
      <p style={{ margin: 0, fontSize: 12.5, color: "#5B6478" }}>同一账号双端互通 · 数据实时同步</p>

      {/* 双端入口卡（设计页 56：两张白卡 r18，图标胶囊 + 标题/说明/特性 + 全宽按钮） */}
      <div style={{ width: 880, maxWidth: "100%", display: "flex", flexWrap: "wrap", gap: 20, marginTop: 28 }}>
        <EntryCard
          icon={<DesktopOutlined style={{ fontSize: 20 }} />}
          iconBg="#5B7FFF"
          iconColor="#fff"
          title="电脑端工作台"
          desc="大屏高效管理（推荐）"
          features="库存 · 报表 · 系统管理 · 线缆地图 · 知识库"
          btnText="进入电脑端"
          primary
          onClick={() => pick("desktop")}
        />
        <EntryCard
          icon={<MobileOutlined style={{ fontSize: 20 }} />}
          iconBg="#EAEFFF"
          iconColor="#3B5BDB"
          title="手机端工作台"
          desc="移动办公 · 随身上报"
          features="拍照识别 · 领用申请 · 我的任务 · 地图导航"
          btnText="进入手机端"
          onClick={() => pick("mobile")}
        />
      </div>

      {/* 3 秒倒计时提示（手动点击任一卡片即取消） */}
      <div style={{ marginTop: 22, fontSize: 12.5, color: "#5B6478", minHeight: 20 }}>
        {autoTarget && !stopped ? (
          <>
            <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, color: "#3B5BDB" }}>{Math.max(countdown, 0)}s</span>
            {" "}后自动进入{autoTarget === "mobile" ? "手机端" : "电脑端"} ·{" "}
            <a onClick={stopTimer} style={{ fontSize: 12.5 }}>
              取消自动跳转
            </a>
          </>
        ) : stopped === "loop" ? (
          "检测到反复跳转，已暂停自动进入 —— 请点击上方卡片选择终端"
        ) : stopped === "manual" ? (
          "已取消自动跳转，请点击上方卡片选择终端"
        ) : null}
      </div>
    </div>
  );
}

/** 入口选择卡（设计页 56 Entry）：r18 白卡 + 图标块 44×44 r13 + 三行文案 + 全宽 r11 按钮。 */
function EntryCard(props: {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  title: string;
  desc: string;
  features: string;
  btnText: string;
  primary?: boolean;
  onClick: () => void;
}) {
  const { primary = false } = props;
  return (
    <div
      onClick={props.onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onClick();
        }
      }}
      aria-label={props.title}
      style={{
        flex: 1,
        background: "#FFFFFF",
        borderRadius: 18,
        padding: "24px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        boxShadow: "0 10px 30px rgba(30,36,51,0.07)",
        border: "1px solid #EFF3FC",
        cursor: "pointer",
        transition: "transform .18s ease, box-shadow .18s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 14px 34px rgba(30,36,51,0.12)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "none";
        e.currentTarget.style.boxShadow = "0 10px 30px rgba(30,36,51,0.07)";
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 13,
          background: props.iconBg,
          color: props.iconColor,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {props.icon}
      </div>
      <div style={{ fontSize: 15.5, fontWeight: 700, color: "#1E2433", marginTop: 4 }}>{props.title}</div>
      <div style={{ fontSize: 12, color: "#5B6478" }}>{props.desc}</div>
      <div style={{ fontSize: 11.5, color: "#6A748A", lineHeight: 1.7 }}>{props.features}</div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          props.onClick();
        }}
        style={{
          marginTop: 8,
          height: 41,
          borderRadius: 11,
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          fontSize: 13,
          fontWeight: 600,
          fontFamily: "inherit",
          background: primary ? "#5B7FFF" : "#F6F8FE",
          color: primary ? "#FFFFFF" : "#3B5BDB",
          transition: "filter .15s ease",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(1.04)")}
        onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
      >
        {props.btnText}
        <RightOutlined style={{ fontSize: 11 }} />
      </button>
    </div>
  );
}
