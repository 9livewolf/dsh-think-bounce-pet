# macOS 窗口拖拽回归测试

macOS 桌面外壳（Electron）按文档顺序几何合成 `-webkit-app-region` 拖拽矩形：
后出现的盒子会覆盖先出现的。DSH 的 `base.css` 把 `body` 下除 `#root` 外的节点
一律声明成 `no-drag`，而插件的漂浮层曾经是覆盖全窗口的 body 级被动层、又是
文档里最后一个盒子，于是把整个顶栏拖拽面“减”掉——装完插件窗口就拖不动。

这个测试把 DSH 的那套规则复刻到一个普通网页里，跑真正的 `lib/client.js`（用
桩替换 react / ctx），让球在 5 秒里自由弹跳，然后断言：

1. 漂浮层不再生成盒子（`display: contents`）；
2. 拖拽行上除了球自己占住的那一段，其余采样点都必须可拖；
3. 球只在和 `[data-window-drag]` 行几何重叠时才带 `no-drag`；
4. 拖拽行撤销后标记被撤回、`data-window-drag-recall` 不残留；
5. 球改成 `position: fixed` 后包围盒中心仍与 transform 一致（位置没有偏移）。

## 运行

```bash
bash tests/drag-guard/run.sh
```

需要 `python3` 和一个 Chromium 系浏览器（Chrome / Chromium / Edge）。
脚本会在临时目录起一个本地静态服务（含一个故意变慢的 `/slow` 图片，用来把
页面的 `load` 事件拖到断言跑完之后），用无头 Chrome `--dump-dom` 取回结果；
通过时退出码 0，失败时打印 JSON 明细并返回非 0。

> 这是针对“窗口拖拽不被插件破坏”的几何契约测试，不覆盖球的手感/物理。
