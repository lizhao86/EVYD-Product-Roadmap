# EVYD Product Roadmap

可视化产品 Roadmap 电子白板，纯前端实现，无需服务器，数据本地持久化。

## 快速开始

直接用浏览器打开 `index.html` 即可，无需安装任何依赖。

```bash
open index.html
# 或通过本地服务器
python3 -m http.server 3000
```

## 功能

- 财年视图（4月–次年3月），按月分列，今日红线始终显示
- **双视图切换**：模块视图（按功能模块分组）/ Pillar 视图（按高层价值主题分组，面向汇报）
- 按模块分组，颜色自动分配；Pillar 视图中条形保留模块颜色，便于跨模块识别
- **筛选**：按执行人（负责人）筛选、按配合团队筛选，支持多选，筛选结果实时更新
- 拖拽条形调整开始月份，拖拽右侧手柄调整时长（支持跨年至次年3月）
- 模块/Pillar 可重命名、合并、拖拽排序
- 点击条形编辑/删除
- 悬停显示详情 tooltip
- **加载 CSV**：全量替换当前数据
- **增量导入**：追加 CSV 内容，不覆盖已有条目
- 导出 CSV（UTF-16 LE 编码，兼容 Windows Excel / WPS 直接双击打开，不乱码）
- 导入支持自动识别 UTF-16 LE / UTF-8 BOM / UTF-8 编码，导出后可直接重新导入
- 数据存储于 localStorage，刷新不丢失

## CSV 数据格式

```csv
author,module,pillar,problem,title,description,outcome,collaborators,startMonth,duration
Lynn,数据展示,平台体验,现有图表加载慢,图表组件重构,重构图表渲染层,加载速度提升50%,,4,3
```

| 列 | 必填 | 说明 |
|----|------|------|
| `author` | ❌ | 负责人姓名，支持逗号分隔多人；用于执行人筛选 |
| `module` | ✅ | 所属模块，同名自动归组 |
| `pillar` | ❌ | 所属 Pillar（高层价值主题），用于 Pillar 视图汇报；留空则归入「未分配」 |
| `problem` | ❌ | 解决的问题 |
| `title` | ✅ | 功能标题，显示在条形上 |
| `description` | ❌ | 详细描述 |
| `outcome` | ❌ | 预期效果 |
| `collaborators` | ❌ | 协作团队，多个用 `;` 分隔；用于配合团队筛选 |
| `startMonth` | ✅ | 开始月份 1–12（1=1月，4=4月） |
| `duration` | ✅ | 持续月数，财年内最长到次年3月 |

## 文件结构

```
index.html   页面结构
styles.css   样式
app.js       逻辑（数据、渲染、拖拽、导入导出）
```

详细使用说明见 [使用手册.md](./使用手册.md)。
