# 故事影像工作台

自己的一套「写故事 → 拆分镜 → 出图 → 配音 → 合成」工作台。不是复刻某个站，功能按同类产品自己实现。

## 它能做什么

- **自由创作 / 我的项目**：一个故事一个项目，带风格设定
- **拆分镜**：填好剧本接口后，一键把故事拆成 4–8 个镜头
- **逐镜出图**：每个镜头单独重生成，图存在 `data/media/`
- **出视频**：填好视频接口后，按镜头提交任务
- **我的资产**：所有已出的图集中看
- **接口设置**：剧本 / 生图 / 视频三个接口在页面上自己填，不用改代码

## 三条接口怎么填

都是 OpenAI 兼容格式，任何一家都能接：

| 用途 | 请求路径 | 必填 |
|---|---|---|
| 剧本分镜 | `{baseUrl}/chat/completions` | baseUrl、key、model |
| 生图 | `{baseUrl}/images/generations` | baseUrl、key、model、size |
| 视频 | 你填的 `baseUrl` 直接 POST | baseUrl、key、model |

例：`baseUrl` 填 `https://api.xxx.com/v1`，key 填 `sk-xxx`。

视频接口的约定（简单直接）：

```json
POST {baseUrl}
{ "model": "...", "prompt": "画面描述", "image": "参考图地址" }
```

返回里带 `url` 或 `data.url` 就会被存成该镜头的视频。

## 跑起来

```bash
node server.mjs 8780        # 默认 8780 端口
```

打开 `http://127.0.0.1:8780/`。

无依赖，不需要 npm install。Node 18+ 即可。

## 目录

```
server.mjs        后端：项目、分镜、生成、配置
public/index.html 前端：单页工作台
config.json       接口配置（页面里改也可以）
data/data.json    项目数据
data/media/       生成出来的图
```

## 还没做的

- 配音与合成导出：目前接口位留着，下一步接 ffmpeg 把图 + 配音 + 字幕拼成片
- 账号体系：现在是单用户本地跑，多人用要加登录
- 任务队列：现在是同步调用，长任务建议改成任务表 + 轮询
