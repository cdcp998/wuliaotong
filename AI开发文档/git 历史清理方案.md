# git 历史清理方案（评审 P0-2）

> **决策记录（2026-08-22）**：仓库已公开发布，用户确认**不执行历史重写**（接受现状）。
> 本文档保留为「如需在开源合规前处理」的备用方案；执行前需再次确认（破坏性、不可逆）。

## 结论（已实证核实）

- **当前工作树/已跟踪文件：零凭据残留** ✅
  - `git grep -n 'cdcp520' HEAD` → 无匹配；README 示例口令已掩码（`root:***`）；docker-compose 用 `${MYSQL_ROOT_PASSWORD:-root}` 变量。
  - `.gitignore` 已忽略 `.env*`、`backend/data/`、`backend/certs/`、`开源发布/`、`dsh-usage/`。
- **git 历史仍含真实开发库口令 `cdcp520`** ❌（必须处理，否则开源即泄露）
  - 位置：早期 README 本地环境说明（`root/cdcp520`）与测试/联调脚本连接串（`mysql+pymysql://root:cdcp520@127.0.0.1:3306/wuliaotong`）。
  - 其余命中均为 CI 测试凭据（`test123`/`admin123`）与代码参数名，非真实密钥。
- **远端**：`origin = https://github.com/cdcp998/wuliaotong.git`（132 个提交）——重写历史需 force-push，属**破坏性、不可逆**操作。

## 建议的执行方式（按顺序）

### 0) 前置备份（必做）
```bash
# 本地整仓备份（含全部 refs/objects）
git clone --mirror origin  wuliaotong-mirror-backup.git
```

### 1) 安装 git-filter-repo
```bash
pip install git-filter-repo        # 或 pipx install git-filter-repo
git filter-repo --version
```

### 2) 清理历史中的凭据（替换为占位符，保留提交结构）
```bash
cd G:\wuliaotong_dev
# 把 cdcp520（真实口令）替换为占位，避免出现在任何历史 blob
git filter-repo --replace-text <(printf 'cdcp520=>CHANGE_ME\n')
# 可选：同时替换示例 root:test123 等测试口令为占位（非必须，本就不是真实凭据）
# git filter-repo --replace-text <(printf 'root:test123=>root:CHANGE_ME\nadmin123=>CHANGE_ME\n')
```

> 用 `--replace-text`（而非删除文件）可保留提交结构、最大程度不破坏他人基于旧 SHA 的引用；
> 若希望彻底删除某些提交/文件再考虑 `--path` / `--invert-paths`。

### 3) 验证无残留
```bash
git log --all -p | grep -n 'cdcp520'            # 应无输出
git grep -n -E 'sk-|ghp_|AKIA|BEGIN .*PRIVATE KEY' HEAD   # 应无输出
git rev-list --count HEAD                        # 与清理前对比（commit 数不变）
```

### 4) 关联并推送（破坏性，需确认）
```bash
git remote add origin https://github.com/cdcp998/wuliaotong.git
git push --force --all origin
git push --force --tags origin
```

### 5) 通知协作者
- 历史已重写，所有本地 clone 需重新 clone（或 `git fetch && git rebase --onto` 重建）。
- GitHub 上旧 SHA 的 PR/issue 引用会失效，建议发布前集中执行一次。

## 风险提示
- **不可逆**：重写后旧 SHA 永久失效；务必先做镜像备份。
- **force-push 影响**：若仓库已被他人 clone/存在公开 fork，需评估影响。
- 若目标仓库尚未公开且不介意丢历史，也可选择「发布前重建仓库」（git init + 重新提交脱敏后内容），
  更简单但丢失历史。

## 本评审建议
- 若仓库**尚未公开**：优先在正式发布（开源）前执行一次本方案，一次到位。
- 若**已公开/多人协作**：先与协作者协调维护窗口，再执行 force-push。
- 当前开发继续无需处理；此事项仅影响开源发布前。
