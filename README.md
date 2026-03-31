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
- 按模块分组，颜色自动分配
- 拖拽条形调整开始月份，拖拽右侧手柄调整时长（支持跨年至次年3月）
- 模块可重命名、合并、拖拽排序
- 点击条形编辑/删除
- 悬停显示详情 tooltip
- 导入 / 导出 CSV（UTF-16 LE 编码，兼容 Windows Excel / WPS 直接双击打开，不乱码）
- 数据存储于 localStorage，刷新不丢失

## CSV 数据格式

```csv
author,module,problem,title,description,outcome,collaborators,startMonth,duration
Lynn,数据展示,现有图表加载慢,图表组件重构,重构图表渲染层,加载速度提升50%,,4,3
```

| 列 | 必填 | 说明 |
|----|------|------|
| `author` | ❌ | 负责人姓名 |
| `module` | ✅ | 所属模块，同名自动归组 |
| `problem` | ❌ | 解决的问题 |
| `title` | ✅ | 功能标题，显示在条形上 |
| `description` | ❌ | 详细描述 |
| `outcome` | ❌ | 预期效果 |
| `collaborators` | ❌ | 协作团队，多个用 `;` 分隔 |
| `startMonth` | ✅ | 开始月份 1–12（1=1月，4=4月） |
| `duration` | ✅ | 持续月数，财年内最长到次年3月 |

## 文件结构

```
index.html   页面结构
styles.css   样式
app.js       逻辑（数据、渲染、拖拽、导入导出）
```

详细使用说明见 [使用手册.md](./使用手册.md)。
