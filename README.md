# EVYD Product Roadmap

可视化产品 Roadmap 电子白板，纯前端 + Vercel Serverless，数据云端持久化，多人协作。

## 在线使用

直接访问：**https://evyd-product-roadmap.vercel.app/**

多人共享同一份数据，编辑后刷新即可看到最新内容。

## 本地开发

```bash
npm install            # 安装 @vercel/blob 依赖
npx vercel dev         # 本地启动（含 API 路由）
# 或纯静态预览（无远程存储）
open index.html
```

## 功能

- 财年视图（4月–次年3月），按月分列，今日红线始终显示
- **双视图切换**：
  - **价值视图**：Pillar（外层）→ Project（内层），Pillar 描述横跨时间轴通栏显示，面向战略汇报
  - **项目视图**：Project（外层）→ Module（内层），面向交付管理
- 两层分组均可独立折叠/展开；外层支持拖拽排序、重命名
- 条形颜色按 Module 分配，切换视图颜色保持一致，便于跨维度识别
- **项目类型标记**：每个条形显示 Dev Type 方形角标（NC / R&D / Mnt），颜色区分
- **三维筛选**：执行人、配合团队、项目类型，多选，实时生效
- 拖拽条形调整开始月份，拖拽右侧手柄调整时长（支持跨年至次年3月）
- 外层分组可重命名、合并、拖拽排序
- 点击条形编辑/删除；悬停显示详情 tooltip（含项目类型）
- **左侧列宽可拖拽调整**（120px–400px），宽度持久化保存
- **加载 CSV**：全量替换当前数据
- **增量导入**：追加 CSV 内容，不覆盖已有条目
- 导出 CSV（UTF-8 BOM 编码，兼容 Mac Excel / Windows Excel / WPS / Google Sheets）
- 导入支持自动识别 UTF-16 LE / UTF-8 BOM / UTF-8 编码
- 数据存储于 Vercel Blob 远程存储（private access），多人共享，刷新即同步
- 乐观锁冲突检测，防止多人同时编辑覆盖

## CSV 数据格式

```csv
pillar,pillar values,project,module,feature,feature problem,feature description,feature outcome,author,collaborators,startMonth,duration,dev type
Enhance Clinical Quality & Efficiency,通过 AI 提升...,Dr. Copilot Pilot Program,DW,#3 AI PHR Summary,医生难以快速把握患者全貌,AI 生成患者总概览,帮助医生更快准备会诊,CY,Medical,4,2,New Contract
```

| 列 | 必填 | 说明 |
|----|------|------|
| `pillar` | ❌ | 所属 Pillar（战略价值主题），价值视图外层分组 |
| `pillar values` | ❌ | Pillar 的战略价值描述，显示在价值视图通栏 |
| `project` | ❌ | 所属项目，价值视图内层 / 项目视图外层分组 |
| `module` | ✅ | 所属模块，项目视图内层分组，也决定条形颜色 |
| `feature` | ✅ | 功能标题，显示在条形上 |
| `feature problem` | ❌ | 解决的问题 |
| `feature description` | ❌ | 详细描述 |
| `feature outcome` | ❌ | 预期效果 |
| `author` | ❌ | 负责人，支持逗号分隔多人 |
| `collaborators` | ❌ | 协作团队，多个用 `;` 分隔 |
| `startMonth` | ✅ | 开始月份 1–12（4=4月，财年起始） |
| `duration` | ✅ | 持续月数，最长到次年3月 |
| `dev type` | ❌ | 项目类型：`New Contract` / `R&D` / `Maintenance` |

## 文件结构

```
index.html       页面结构
styles.css       样式
app.js           逻辑（数据、渲染、拖拽、导入导出）
api/data.js      Vercel Serverless Function（远程数据读写，private access + 签名 URL）
package.json     依赖声明（@vercel/blob）
vercel.json      路由与缓存配置
```

## 部署配置

项目通过 GitHub 自动部署到 Vercel。需要在 Vercel 项目设置中配置：

1. **创建 Blob Store**：Vercel Dashboard → Storage → Create Blob Store
2. **环境变量**：`BLOB_READ_WRITE_TOKEN`（创建 Blob Store 时自动生成）

详细使用说明见 [使用手册.md](./使用手册.md)。
