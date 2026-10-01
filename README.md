# 便签台 · Windows 桌面版（Tauri v2）

把墙面便签"贴"到 Windows 桌面：每张便签是一个**无边框原生小窗**，可钉在所有窗口之上、
跟随开机常驻托盘、到点弹**系统级通知**。前端内核与网页版 v16.3 同源（同一份 HTML + Tauri 集成层）。

> 状态：工程完整、前端逻辑经 60+ 单测与双端 e2e 验证。**Rust/打包链路尚未在真机跑过**
> （沙箱是 Linux，无法编译 Windows Tauri 或点托盘）。首次本地构建如遇 API 小偏差，
> 按下方「首构可能踩的点」修，通常几分钟级别。

## 功能 → 桌面语义映射
| 网页版 | 桌面版 |
|---|---|
| 📌 置顶 | `setAlwaysOnTop`（钉桌面 / 钉窗口上） |
| 标题栏拖便签 | 原生窗口拖动（`startDragging`，60fps，可贴屏幕边缘吸附） |
| 右下角缩放 | 窗口边框缩放（几何自动记忆，重开还原） |
| 折叠 `36px` | 窗口收缩为标题条 |
| ⋯ → 归档 / Alt+F4 关窗 | 便签收回"墙底架"，托盘可一键放回 |
| 到点提醒（浏览器通知） | **Tauri 通知插件 → Windows 原生通知**（托盘 daemon 兜底调度，卡片窗口开着也能收到） |
| 过期红时钟常亮 | 同网页版（v16.3 语义） |
| 标签/底栏/搜索/语法主题/导出 md | 全部保留（每张卡窗内可用） |
| 数据 | 与网页同一套 localStorage（首次启动**空库**，可在任意卡窗用"导入"读网页版导出的 .json；数据文件随 WebView2 user-data 落盘） |

托盘右键菜单：`新建便签` / `把归档放回桌面` / `退出便签台`。
退出只从托盘走——关卡片=归档，不会杀掉其他便签。

## 目录结构
```
src/sticky-base.html   v16.3 单文件网页版（= Tauri 前端底版）
src/tauri-window.js    桌面集成层（窗口模型/几何档/通知/托盘事件）
src/app-icon.png       应用图标源图（1024）
build-web.mjs          组装：base + 集成层 → dist-web/index.html
src-tauri/             Rust 外壳（main.rs 托盘+通知插件 / conf / capabilities）
.github/workflows/     Windows CI 自动打包（推荐，免本机装工具链）
```

## 路线 A：GitHub Actions 打包（推荐，零本地环境）
1. 把本目录整体推到 GitHub 仓库（main 分支）
2. Actions → `build-windows-installer` → Run workflow
3. 完成后在 artifact `stickyboard-desktop` 下载：
   - `StickyBoard_16.3.0_x64-setup.exe`（NSIS 安装器）
   - `StickyBoard_16.3.0_x64_zh-CN.msi`

## 路线 B：本机编译（Windows）
前置安装（一次即可）：
- WebView2 运行时（Win11 自带；Win10 装 Evergreen 版）
- Rust：`rustup` 选 `stable-msvc`（装时勾选"更新 MSVC C++"或先装 *Visual Studio Build Tools → 使用 C++ 的桌面开发*）
- Node 20+

```powershell
git clone <repo> ; cd stickyboard-desktop
npm install
npm run icons     # 从 src/app-icon.png 生成 src-tauri/icons/*
npm run build     # 自动先 build-web 再 tauri build
# 产物在 src-tauri\target\release\bundle\
```

## 首构可能踩的点（预留清单）
1. **icons**：`tauri build` 要求 `src-tauri/icons/icon.ico` 存在——必须先跑 `npm run icons`（CI 已内置）
2. **tray API 版本差**：若你拿到的是更早/更新 v2 小版本，`TrayIconBuilder` 个别方法名或
   `event.id.as_ref()` 可能提示改名，按编译报错行微调即可（逻辑不变）
3. **capabilities**：`windows` 匹配 `"card-*"` glob；如果窗口 label 规则被改，需在
   `src-tauri/capabilities/default.json` 同步
4. **WebView2 storage 事件隔离**：集成层已内置 2.5s 轮询兜底，跨窗同步不依赖 storage 事件
5. 首次运行弹通知权限：Windows 设置 → 通知 → 允许 StickyBoard 显示通知

## 开发模式
`npm run dev`（热调试；conf 里 daemon 是 1×1 隐藏窗，卡片窗正常弹出）

## 与网页版的关系
- `dist-web/index.html` 不带参数打开 = 等价网页版（`window.__TAURI__` 不存在时集成层整段旁路），
  所以 Tauri 外还可以直接用浏览器开这个文件调试
- 集成层对原 UI 采用**函数覆写 + capture 阶段拦截**，不改 base 一行；网页版升级到
  新 v16.x 后，把 `src/sticky-base.html` 换成新单文件重跑 `npm run web` 即可跟进
