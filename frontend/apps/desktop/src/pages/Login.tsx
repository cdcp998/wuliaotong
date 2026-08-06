import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { otherEndUrl, useAuthStore } from "@wlt/shared";

export function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const loading = useAuthStore((s) => s.loading);
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await login(username, password);
      navigate("/app", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    }
  }

  return (
    <div style={styles.wrap}>
      <form style={styles.card} onSubmit={onSubmit}>
        <h1 style={styles.title}>物料通管理系统</h1>
        <input
          style={styles.input}
          placeholder="用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
        />
        <input
          style={styles.input}
          type="password"
          placeholder="密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div style={styles.error}>{error}</div>}
        <button style={styles.button} type="submit" disabled={loading || !username || !password}>
          {loading ? "登录中..." : "登 录"}
        </button>
        <a href={otherEndUrl("mobile")} style={{ textAlign: "center", color: "#1677ff", fontSize: 13, textDecoration: "none" }}>
          手机版入口
        </a>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f0f2f5" },
  card: { width: 340, padding: 40, background: "#fff", borderRadius: 8, boxShadow: "0 2px 12px rgba(0,0,0,.08)", display: "flex", flexDirection: "column", gap: 16 },
  title: { fontSize: 22, textAlign: "center", margin: 0, color: "#1677ff" },
  input: { height: 40, padding: "0 12px", borderRadius: 6, border: "1px solid #d9d9d9", fontSize: 14 },
  button: { height: 40, borderRadius: 6, border: "none", background: "#1677ff", color: "#fff", fontSize: 15, cursor: "pointer" },
  error: { color: "#ff4d4f", fontSize: 13 },
};
