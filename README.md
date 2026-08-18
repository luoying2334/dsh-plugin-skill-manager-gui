# dsh-plugin-skill-manager-gui

中文 | [English](README.en.md)

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的**图形化技能管理器**。在网页设置里即可新建、编辑、导入、删除 `SKILL.md` 技能——不用开终端，也不用手写 YAML frontmatter。

| | |
|---|---|
| npm 包 | `dsh-plugin-skill-manager-gui` |
| 分类 | `dsh-plugin` |
| 许可证 | [MIT](LICENSE) |

## 功能

- **列出**已管理的技能，展示描述、安装位置与调用开关。
- **新建**技能：名称（kebab-case）、描述、可选的 `whenToUse`、安装位置、模型/用户调用开关，以及 Markdown 指令正文。
- **编辑**已有技能（编辑时名称不可改，改名请删除后重建）。
- **删除**，带二次确认。
- **导入 ZIP**：把 `<name>/SKILL.md`（或 `<name>.md`，含嵌套资源）导入到「全局」或某个工作区；也支持直接打包整个技能文件夹。
- **全局 或 工作区（工作区可多选）**：安装到本机全局根（`$DSH_HOME/skills`）或一个/多个工作区（`<workspace>/.dsh/skills`），保存后可随时改换位置（移动）；同一技能装到多个工作区时列表自动合并为一条——正是内置 `skill-filesystem` 提供者本来就会扫描的目录，写入后无需重启即可被识别。
- 中英双语、跟随主题，使用 DSH 原生 UI 原子组件渲染。

## 安装

```sh
dsh plugin --profile web add dsh-plugin-skill-manager-gui
```

重启 `dsh web`，然后打开 **设置 → 技能**。

> 从 Git 安装会运行包内 `prepare` 构建脚本，pnpm ≥ 10 默认拦截，直到你放行。把 pnpm 打印的键复制进该 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds`，再重跑即可。从 npm 或 tarball 安装则无需放行。

## 使用

1. 打开 **设置 → 技能**。
2. 点击 **新建技能**，填写表单、勾选一个或多个安装位置，点击 **保存**；或点击 **导入 ZIP** 批量导入。
3. 技能以目录 bundle 落盘：

   ```
   $DSH_HOME/skills/<name>/SKILL.md          # 全局（user）
   <workspace>/.dsh/skills/<name>/SKILL.md   # 某个工作区
   ```

4. 内置 skill 发现会在下一次扫描时拾取它——模型可通过 `skill` 工具加载，输入框 `/` 菜单也会把它列为可调用项。

## 工作原理

本包是一个标准的树外插件，宿主端 + 浏览器端合一的「双面」bundle：

- **宿主端**（`src/index.ts`）注入 `webServer` 与 `workspaceRegistry`，在 `/skill-manager` 下注册读写 `SKILL.md` 的 HTTP 路由。
- **浏览器端**（`src/client/`）注册 `settings.section`，用 `fetch` 调用这些路由。

线协议、安全模型与目录结构详见 [docs/architecture.zh.md](docs/architecture.zh.md)。

## 安全

变更类路由（`write`、`remove`、`import`）会以宿主用户权限写文件，因此**仅限回环地址且要求同源**——与 harness 自身特权操作使用同一道边界。只读路由（`list`、`read`、`workspaces`）不写文件。ZIP 导入会逐条校验条目路径，杜绝 `..` 或绝对路径逃逸目标根目录。

## 开发

需要 Node.js 22.19+（推荐 24）与 npm。

```sh
npm install        # 会触发 prepare → build
npm run typecheck  # 宿主 + 客户端 tsc
npm test           # vitest 单元测试（宿主技能存储）
npm run build      # tsc（宿主 lib/）+ tsdown（client/client.js）
```

## 目录结构

```
src/
  index.ts               宿主入口：在 webServer 上挂载 HTTP 路由
  routes.ts              /skill-manager 路由分发
  skills.ts              SKILL.md 文件服务（list/read/write/remove）
  import.ts              ZIP 导入（安全解压）
  http.ts                JSON + 同源 + 回环校验工具
  types.ts               共享线协议类型
  client/
    index.ts             客户端入口：settings.section 注册
    SkillManager.tsx     React 设置页 UI
    SkillManager.module.css
    locales.ts           zh / en
cordis.patch.yml         bundle patch 层
tsdown.config.ts         客户端 bundle 构建（__ModuleLoader__ factory）
.github/workflows/       ci.yml + release.yml
```

## 参与贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE)
