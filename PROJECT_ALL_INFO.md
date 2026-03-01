# Feishu Chat Summary Bot - 全局项目信息

> 本文档用于记录项目的演进历史、全局需求变更、架构设计与核心技术选型。
> (受控于 `session-experience-manager` 技能，每次会话结束时强制更新)

## 📌 项目概述
本项目是一个基于 Node.js 运行的飞书群聊助手机器人。其核心功能是：通过飞书长连接监听群聊消息，持久化存储到飞书多维表格（Bitable），并允许用户在群内 `@Bot` 使用自然语言（如“总结王林最近10条消息”），经由 Gemini API 意图解析后，从数据表中检索相关聊天记录并生成摘要总结。

---

## 📅 [2026-02-28 至今] Session 演进纪要

### 1. 核心需求变更与实现
- **Bitable 持久化**：完成在 `Chat_History` 表中的发言及历史消息数据入库机制。
- **智能化指令总结**：支持通过自然语言 @Bot 触发总结，大模型解析意图后，支持指定时间、条数、对应人名的多种倒序检索过滤。
- **动态读表热更新**：建立 `Bot_Config` 表。系统支持热更新大模型 Base URL、API Key、模型名称、乃至 System Prompt，改变配置无需重新部署。
- **发言人精准解析与纠错**：解决表格底层存储为 `open_id`，而用户输入为“中文名字”的联合查询痛点。引入 `im:chat.members:read` 权限读取完整群成员，并通过基于 Levenshtein 的模糊匹配算法纠正姓名的错别字输入（如"王林"纠正为"黄林"）。

### 2. 重要架构与开发变更
- **意图解析引擎重构**：由早期的写死逻辑转变为先调 Gemini 强制输出 JSON (`parseIntent`) 进行参数提取。
- **查询过滤重构 (`queryRecords`)**：抽象且强化了多维表格查询接口，现已支持在一条查询语句中融合数量、时效及发件人条件的布尔与筛选。
- **执行安全保证 (Await 策略)**：修复在无服务器云引擎中由于异步调用悬挂导致的静默卡死，所有核心外部请求与处理全链路强制 `await` 接入捕获。
- **群聊艾特 (Mention) 精准判断重构**：修复了通过 `mentions.some(m => content.includes(m.key))` 粗放匹配导致的“任意艾特均可触发机器人”串联 Bug，改为在系统启动后调用 `bot/v3/info` 接口动态获取机器人的 `open_id`，从而实现精准定位触发源。

### 3. 重要技术选型变更
- **弃用 Serverless Webhook (GAS/Cloudflare)**：考虑到国内网络直连、飞书内网验签、严格的 3 秒超时限制以及验证墙，推翻了早期企图使用纯挂载 Webhook 的 Serverless 架构。
- **确立 Node.js + WebSocket 长连接模式**：借助 `@larksuiteoapi/node-sdk` 内置的 `WSClient` 彻底解决内网穿透与防火墙公网地址问题，无需繁琐的 Challenge 校验。
- **部署环境变更至 Render**：转为 Render 免费计算云部署容器化 Node 实例，并通过巧妙内置 `http.createServer` 与定时四分钟请求自身的 Keep-Alive 策略绕过了免费实例休眠策略。
- **核心大脑层接入 Gemini**：所有意图解析与正文摘要高度依赖 Gemini API 的 `gemini-2.5-flash` （或配置指定），通过 Prompt 拆解上下文。
