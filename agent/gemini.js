import dotenv from "dotenv";
import Anthropic from "@anthropic-ai/sdk";

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const CLAUDE_MODEL = "claude-3-5-haiku-20241022";

function getClaudeText(response) {
  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function extractJson(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error("Claude did not return JSON.");
  }

  return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
}

function fallbackExtract(userMessage) {
  const emailMatch = userMessage.match(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
  );

  const orderMatch = userMessage.match(/ORD-\d+/i);

  return {
    customerEmail: emailMatch ? emailMatch[0] : null,
    orderId: orderMatch ? orderMatch[0].toUpperCase() : null
  };
}

export async function extractRefundInfo(userMessage) {
  const fallback = fallbackExtract(userMessage);

  const prompt = `
Extract the customer email and order ID from this refund request.

Important:
- "another refund" does not mean there is another order.
- Use the explicit order ID if one is present.
- Return ONLY valid JSON. No markdown. No explanation.

Format:
{
  "customerEmail": "string or null",
  "orderId": "string or null"
}

Customer message:
${userMessage}
`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 300,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      });

      const text = getClaudeText(response);
      const parsed = extractJson(text);

      return {
        customerEmail: parsed.customerEmail || fallback.customerEmail,
        orderId: parsed.orderId || fallback.orderId
      };
    } catch (error) {
      console.error(
        `Claude extractRefundInfo attempt ${attempt} failed:`,
        error.message
      );

      if (attempt === 3) {
        return fallback;
      }

      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }

  return fallback;
}

export async function generateCustomerResponse({
  decision,
  reason,
  order,
  orderId
}) {
  const prompt = `
You are a professional e-commerce refund support agent.

Write a concise customer-facing response.

Rules:
- The decision is final.
- Do not offer exceptions.
- Do not mention internal tools or traces.
- If approved, mention refund goes to original payment method ending in last four digits.
- If denied, explain the policy reason clearly.
- If escalated, say a human support manager will review it.

Decision: ${decision}
Reason: ${reason}
Order ID: ${order?.order_id || orderId}
Payment Method: ${order?.payment_method || "N/A"}
Card Last Four: ${order?.card_last_four || "N/A"}
`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 500,
        temperature: 0.2,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      });

      return {
        text: getClaudeText(response),
        usageMetadata: {
          promptTokenCount: response.usage?.input_tokens || 0,
          candidatesTokenCount: response.usage?.output_tokens || 0,
          totalTokenCount:
            (response.usage?.input_tokens || 0) +
            (response.usage?.output_tokens || 0)
        }
      };
    } catch (error) {
      console.error(
        `Claude generateCustomerResponse attempt ${attempt} failed:`,
        error.message
      );

      if (attempt === 3) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }
}