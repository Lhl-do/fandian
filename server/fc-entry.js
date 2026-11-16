/**
 * 阿里云函数计算 FC 适配入口（可选，本地开发仍用 server/index.js）。
 *
 * 现象：FC 的 HTTP 网关会给所有未显式声明 Content-Disposition 的响应补上 "attachment"，
 * 于是浏览器把首页和静态资源当成下载文件；用户双击下载下来的 HTML 时，css/js 相对路径失效，
 * 表现为"样式全丢、地图不渲染、页面完全不一样"。
 *
 * 处理：在 node:http 的 ServerResponse 层统一补 "inline"。只加这一个头，不改动 server/index.js。
 * 部署：FC 上把启动命令设为 node server/fc-entry.js
 */
import { ServerResponse } from "node:http";

const originalWriteHead = ServerResponse.prototype.writeHead;

function hasDisposition(headers) {
  return Object.keys(headers).some((key) => key.toLowerCase() === "content-disposition");
}

ServerResponse.prototype.writeHead = function writeHeadWithInline(statusCode, ...rest) {
  const args = rest.slice();
  if (typeof args[0] === "string") {
    if (args[1] && typeof args[1] === "object") {
      args[1] = { ...args[1] };
      if (!hasDisposition(args[1])) args[1]["content-disposition"] = "inline";
    }
  } else if (args[0] && typeof args[0] === "object") {
    args[0] = { ...args[0] };
    if (!hasDisposition(args[0])) args[0]["content-disposition"] = "inline";
  } else if (typeof this.hasHeader === "function" && !this.hasHeader("content-disposition")) {
    this.setHeader("content-disposition", "inline");
  }
  return originalWriteHead.apply(this, [statusCode, ...args]);
};

await import("./index.js");
