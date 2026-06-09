import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import { runRefundAgent } from "./agent/graph.js";
import {
  lookupOrder,
  readRefundPolicy,
  evaluateRefund,
  getTraces,
  resetRefunds,
  resetTraces
} from "./agent/tools.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    status: "running",
    service: "AI Refund Agent"
  });
});

app.post("/api/chat", async (req, res) => {
  try {
    console.log("POST /api/chat body:", req.body);

    const { message } = req.body;

    if (!message) {
      return res.status(400).json({
        error: "Message is required."
      });
    }

    const result = await runRefundAgent(message);

    console.log("POST /api/chat result:", result);

    res.json(result);
  } catch (error) {
    console.error("API /api/chat failed:", {
      message: error.message,
      stack: error.stack,
      name: error.name
    });

    res.status(500).json({
      error: error.message || "Internal server error",
      name: error.name || "Error"
    });
  }
});

app.get("/api/traces", async (req, res) => {
  try {
    const traces = await getTraces();
    res.json(traces);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.get("/api/test-tools", async (req, res) => {
  try {
    const lookup = await lookupOrder("john.smith@email.com", "ORD-1001");
    const policy = await readRefundPolicy();
    const evaluation = lookup.success ? evaluateRefund(lookup.order) : null;

    res.json({
      lookup,
      policyLoaded: policy.success,
      evaluation
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.post("/api/refunds/reset", async (req, res) => {
  try {
    const result = await resetRefunds();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.post("/api/traces/reset", async (req, res) => {
  try {
    const result = await resetTraces();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});