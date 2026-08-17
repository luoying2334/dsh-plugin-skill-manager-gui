# 架构

`dsh-skill-manager` 是一个「双面」的树外 bundle：单个 npm 包同时贡献宿主插件与浏览器设置分区，形状与其他外部 DSH 插件（如 `dshmarket`）一致。

```
浏览器（设置 → 技能）                     宿主（Node）
┌──────────────────────────────┐   fetch   ┌──────────────────────────────┐
│ client/client.js             │ ────────► │ webServer.register(...)      │
│  SkillManager.tsx (React)    │  /skill-  │  routes.ts                   │
│  locales.ts (zh/en)          │  manager  │  skills.ts (SkillStore)      │
└──────────────────────────────┘           │  http.ts (守卫)              │
                                           └──────────────┬───────────────┘
                                                          │ fs
                                           ┌──────────────▼───────────────┐
                                           │ $DSH_HOME/skills  (user)     │
                                           │ <cwd>/.dsh/skills (project)  │
                                           └──────────────────────────────┘
```

## 组合方式

`cordis.patch.yml` 只插入一行宿主配置：

```yaml
- insert:
    - id: dsh-skill-manager
      name: 'dsh-skill-manager'
```

包的 manifest 携带两个声明：

- `dsh.bundle.patch` → 让这行成为可组合的 patch 层（`dsh plugin add` 会把它对齐进 `dsh.profile.bundles`）。
- `dsh.client` → 告知宿主的客户端模块系统去提供浏览器 bundle（`exports["./client"]`）并随客户名册一起挂载。

宿主行解析到 `lib/index.js`，其 `apply` 等待 `webServer`（`ctx.inject(['webServer'], …)`）后再注册路由。浏览器侧因包声明了 `dsh.client` 而被独立地提供并挂载。

## 线协议

所有路由都在 `/skill-manager` 前缀下，请求与响应均为 JSON，带 `cache-control: no-store`。

| 方法 | 路径 | 请求体 / 查询 | 作用 |
|---|---|---|---|
| `GET` | `/skill-manager/list` | — | 返回两个范围合并、按名称排序的 `{ skills: SkillSummary[] }`。 |
| `GET` | `/skill-manager/read` | `?name=&scope=` | 返回单个 `SkillBody`（frontmatter + 正文），或 `404`。 |
| `POST` | `/skill-manager/write` | `SkillWriteRequest` | 新建或更新技能，返回新的 `SkillSummary`。 |
| `POST` | `/skill-manager/remove` | `{ name, scope }` | 删除技能，返回 `{ removed }`。 |

类型统一定义在 `src/types.ts`，两端共享（客户端会内联进自己的 bundle）。

## 技能文件格式

技能以目录 bundle 落盘，便于以后携带 `references/`、`scripts/` 或 `assets/`：

```
<root>/<name>/SKILL.md
```

`SKILL.md` frontmatter（由 `SkillStore` 写入）：

```yaml
name: code-review
description: Review code for bugs
whenToUse: ...            # 可选
disable-model-invocation: false
user-invocable: true
```

调用开关与 DSH `skill-filesystem` 约定对齐：`modelInvocable: false` 映射为 `disable-model-invocation: true`，`userInvocable: false` 映射为 `user-invocable: false`。

## 安全模型

- **变更类路由仅限回环 + 同源**（`assertLocalMutation`）：socket 对端必须是 `127.0.0.1`/`::1`，且 `Origin` 必须匹配 `Host`。这能阻止 `--trusted-host` 放行的局域网客户端或跨站页面以宿主用户权限写技能文件。
- **只读路由不写文件**，处于与其余 Web 界面相同的浏览器信任边界内。
- **名称做校验**（kebab-case）、描述必填，客户端做轻量校验（非权威），`SkillStore` 做权威校验。
- **不碰密钥**：技能文件是用户自写的指令；插件不读凭据或环境变量，也不上传任何数据。

## 客户端 bundle 构建

`tsdown.config.ts` 把 `client/client.js` 构建为 `window.__ModuleLoader__.load({ id, factory })` 闭包。只有 `react`、`react/jsx-runtime` 与 `@deepseek-ai/dsh-client-ui-primitives` 被外部化（从 loader 模块表解析），其余（含 `src/types.ts`、`locales.ts`、CSS module）全部内联。CSS Modules 经 lightningcss 编译，并在 factory 执行时注入插件自有的 `<style data-plugin>` 标签。

`scripts/preflight.mjs` 校验产物仍携带准确的 banner，让「静默的包装回归」在 CI 中响亮失败。
