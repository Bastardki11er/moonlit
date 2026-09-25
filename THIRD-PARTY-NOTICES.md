# Third-Party Notices

Moonlit 使用以下开源软件，特此致谢。

## taibu-core（命理排盘算法）

- 项目：https://github.com/hhszzzz/taibu
- npm：`taibu-core`（仅使用 MIT 许可的 `taibu-core` 包）
- 许可证：MIT License — Copyright (c) 2026 hhszzzz
- 用途：八字 / 紫微斗数 / 西方占星的排盘计算（`backend/divination.js`）
- MIT 许可允许商用、修改与闭源分发；本文件即为版权保留声明。

## 紫微斗数开源样本数据集（可选 RAG 增强）

- 项目：https://github.com/Renhuai123/ziwei-doushu
- 许可证：作者声明可自由商用，唯一要求是保留数据来源署名。
- 用途：`backend/ziwei-rag.js` 可选读取本地样本，为紫微解读提供相似命例参考。
- 数据集本身不随代码分发，需自行下载（见 `tools/fetch-ziwei-samples.sh`）。

## 说明

- 本站 78 张塔罗牌图为 Moonlit 定制绘制，版权归本站所有。
- `.env` 中的密钥（Doubao / ADMIN_TOKEN / XorPay）从不进入 git 仓库。
