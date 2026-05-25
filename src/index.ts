import express from "express";
import { config } from "./config";
import { logUnitMapping } from "./config/units";
import { handleWebhook } from "./controllers/webhook.controller";

const app = express();

// ─── Middlewares ──────────────────────────────────────────────────────────────

app.use(express.json({ limit: "2mb" }));

// ─── Health check ─────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// ─── Webhook Chatwoot ─────────────────────────────────────────────────────────

app.post("/webhook/chatwoot", handleWebhook);

// ─── Iniciar servidor ─────────────────────────────────────────────────────────

logUnitMapping();

app.listen(config.port, () => {
  console.log(`✅ Chatbot MultiVacinas rodando na porta ${config.port}`);
  console.log(`   Webhook: POST http://localhost:${config.port}/webhook/chatwoot`);
  console.log(`   Health:  GET  http://localhost:${config.port}/health`);
});

export default app;
