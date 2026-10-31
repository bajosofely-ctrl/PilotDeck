/* 访问统计配置。两项都留空时，站点不加载任何统计脚本，也不发出任何统计请求。
 * 此本地教育部署禁用外部统计。 */
window.CNM_STATS = {
  // Cloudflare Web Analytics 的 token（站点的统计信标）。填了才会加载 Cloudflare 的信标脚本。
  cloudflareToken: '',
  // 自建事件采集地址（https://…）。填了就用 sendBeacon 把事件以 JSON POST 过去。
  endpoint: '',
  // 可选回调：每个事件都会调用一次，参数是 { event, source, path, ts, ... }。
  onEvent: null
};
