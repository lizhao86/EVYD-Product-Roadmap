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

- 财年视图（4月–3月），按月分列
- 按模块分组，颜色自动分配
- 拖拽条形调整开始月份，拖拽右侧手柄调整时长
- 点击条形编辑/删除
- 悬停显示详情 tooltip
- 导入 / 导出 JSON
- 数据存储于 localStorage，刷新不丢失

## 数据格式

```json
{
  "year": 2026,
  "items": [
    {
      "module": "数据展示",
      "title": "图表组件重构",
      "problem": "现有图表加载慢",
      "outcome": "加载速度提升 50%",
      "startMonth": 1,
      "duration": 3
    }
  ]
}
```

`startMonth`：自然月（1=1月，4=4月）；`duration`：持续月数。

## 文件结构

```
index.html   页面结构
styles.css   样式
app.js       逻辑（数据、渲染、拖拽、导入导出）
```

详细使用说明见 [使用手册.md](./使用手册.md)。
