# 🍪 Ginger Report — 微信聊天分析一键生成

> 基于 [ginger_wechat_portrait](https://github.com/Jiang59991/ginger_wechat_portrait) 的 Web 版本。
> 上传聊天记录 → 一键生成精美人格分析报告。纯前端，零后端，部署即用。

## ✨ 功能

- **多格式支持**：CSV / JSON / TXT / Markdown / 手动输入
- **完整分析报告**：消息统计、行为图表、词云、热力图
- **AI 人格分析**（可选）：Big Five + MBTI + 风格总结，支持 OpenAI / DeepSeek / 智谱 / 通义千问等所有兼容接口
- **精美视觉**：姜饼棕白配色，双人对比蝴蝶图、雷达图
- **一键下载**：报告可导出为独立 HTML 文件，离线查看

## 🚀 使用

直接打开：**[yyh-0428.github.io/ginger-report](https://yyh-0428.github.io/ginger-report/)**

1. 上传或拖拽聊天记录文件
2. 填写你和对方的名字
3. （可选）开启 AI 分析，填入 API Key
4. 点击「🍪 一键生成报告」

## 📊 输入的聊天格式

### CSV（推荐）
WeChatMsg 导出格式，需含 `timestamp` / `datetime`、`is_sender`、`content` 列：
```
CreateTime,IsSender,StrContent
1715900000,1,今天天气真好
1715900100,0,是啊出去走走
```

### JSON
```json
{
  "messages": [
    {"timestamp": 1715900000, "is_sender": 1, "content": "今天天气真好"},
    {"timestamp": 1715900100, "is_sender": 0, "content": "是啊出去走走"}
  ]
}
```

### TXT
```
我: 今天天气真好
对方: 是啊出去走走
```

### Markdown
```
**我**: 今天天气真好
**对方**: 是啊出去走走
```

## 🤖 AI 分析配置

支持所有 OpenAI 兼容接口，常用配置：

| 模型 | API 端点 | 模型名称 |
|------|---------|---------|
| OpenAI | `https://api.openai.com/v1/chat/completions` | `gpt-4o` / `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/v1/chat/completions` | `deepseek-chat` |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | `glm-4-flash` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions` | `qwen-plus` |
| Moonshot | `https://api.moonshot.cn/v1/chat/completions` | `moonshot-v1-8k` |
| Anthropic Claude | `https://api.anthropic.com/v1/messages` | `claude-3-opus-20240229` |

## 🔒 隐私

- 所有处理在**浏览器本地**完成
- API Key 仅存于浏览器 Session Storage，不发送到任何服务器
- 聊天数据不上传，不收集

## 🛠 技术栈

- 纯前端：HTML + CSS + JavaScript
- 图表：ECharts 5 + echarts-wordcloud
- 中文分词：N-gram + 停用词过滤
- 部署：GitHub Pages

## 📄 许可

MIT License