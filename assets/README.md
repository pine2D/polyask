# 项目介绍素材

## README 介绍图

- 文件：[polyask-overview.png](polyask-overview.png)。
- 规格：1660 × 948 PNG，约 1.22 MiB。
- 用途：README 首屏介绍，展示同一问题发往九个 AI 站点、并排比较、整理结果和导出报告。
- 性质：功能示意图，使用抽象回答面板，不是应用或站点截图；不包含真实提问、回答、账号或登录状态。
- 生成方式：2026-10-23 使用内置 `image_gen` 工具生成，原始 PNG 直接入库。
- 视觉依据：仓库 [DESIGN.md](../DESIGN.md) 的靛紫、冷灰与白色，产品事实依据 [PRODUCT.md](../PRODUCT.md) 和 [README.md](../README.md)。
- 维护：站点名单、导出格式或核心能力变化时，同时核对图片文字、README 替代文本与本文提示词；图片不写版本号，也不承诺效率、回答正确性、API 接入或自动更新。

## 原始生成提示词

```text
Use case: ads-marketing.
Create one polished Chinese project introduction hero image for the GitHub README of the existing open-source desktop app "PolyAsk · AI 众答". This is an explanatory product illustration, not a screenshot. Produce a wide landscape image, approximately 1792 × 1024, with crisp legible simplified Chinese and generous whitespace.

Use the actual project visual language: restrained indigo #4f46e5, pale indigo #eeedff, very light cool gray #f4f5f8, white panels, dark charcoal #20212b, secondary gray #626575. Flat editorial layout with subtle layered paper depth, fine borders and only very soft shadows. Clean system-style sans serif Chinese typography. No dramatic gradients, neon, 3D robots, decorative globes, stock photography, or rainbow branding. No invented application logo: use the product name as a typographic wordmark.

Composition: a spacious left introduction area occupying roughly 40% of the image and a large illustrative workspace on the right. Top left is the small product wordmark; beneath it the large bold two-line headline. Under the headline, show two concise supporting lines and a single outlined question card labeled "输入一次". A precise subtle indigo connector fans from that question card to the right workspace, communicating one question sent to multiple selected AI websites. On the right, show exactly nine equally sized clean answer panels in a tidy 3 by 3 grid. Each panel has one readable site name and a few restrained neutral horizontal strokes representing answer text; do not invent answer text, checkmarks, scores, or completion claims. These are conceptual answer panels, not imitation website screenshots. The nine names in reading order: Claude, ChatGPT, Gemini, DeepSeek, 豆包, 千问, Kimi, 元宝, 智谱清言. Make every name large enough to remain readable when the whole image is displayed at a README width of 900px.

Across the bottom, a quiet band explains the workflow with three aligned text groups: "并排比较" then "整理结果" then "导出 Markdown / HTML / PDF", separated by small right arrows. At the lower left or lower edge, show the supported desktop platforms. In the lower right, a small readable "功能示意" label. Maintain at least 65px safe margins and a clear visual hierarchy. Balance the nine panels against the large headline. Avoid dense UI chrome or fake interactive buttons.

Render the following text EXACTLY, no extra marketing copy:
"PolyAsk · AI 众答"
"同一问题，"
"多站并排比较。"
"使用原网页与自己的账号"
"无需 API key"
"输入一次"
"Claude"
"ChatGPT"
"Gemini"
"DeepSeek"
"豆包"
"千问"
"Kimi"
"元宝"
"智谱清言"
"并排比较"
"整理结果"
"导出 Markdown / HTML / PDF"
"Windows · macOS · Linux"
"功能示意"

Constraints: do not show a version number, benchmark, time savings, official third-party logos, API integrations, auto-update, collaboration, or saved question-plan features. No watermark. Do not imply that AI answers have been fact-checked. This illustration should feel like a precise, calm desktop research workbench, not a generic AI advertisement. Opaque background.
```
