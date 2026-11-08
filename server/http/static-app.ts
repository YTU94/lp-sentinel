import express from "express";
import path from "node:path";

export function createStaticApp(directory: string) {
  const app = express();
  app.use(express.static(directory));
  app.get("/{*splat}", (_request, response) => response.sendFile(path.join(directory, "index.html")));
  return app;
}
