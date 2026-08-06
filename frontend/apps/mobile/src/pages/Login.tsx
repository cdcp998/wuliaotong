import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { useAuthStore } from "@wlt/shared";

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
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    }
  }

  return (
    <div style={styles.wrap}>
      <form style={styles.card} onSubmit={onSubmit}>
        <h1 style={styles.title}>物料通</h1>
        <p style={styles.subtitle}>入库 · 出库 · 维修使用</p>
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
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f6f8" },
  card: { width: "82%", maxWidth: 360, padding: "32px 24px", background: "#fff", borderRadius: 12, boxShadow: "0 2px 12px rgba(0,0,0,.08)", display: "flex", flexDirection: "column", gap: 18 },
  title: { fontSize: 26, textAlign: "center", margin: 0, color: "#1677ff" },
  subtitle: { textAlign: "center", color: "#999", fontSize: 13, margin: 0 },
  input: { height: 46, padding: "0 14px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 16 },
  button: { height: 46, borderRadius: 8, border: "none", background: "#1677ff", color: "#fff", fontSize: 17, cursor: "pointer" },
  error: { color: "#ff4d4f", fontSize: 13 },
};
