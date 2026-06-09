import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

export async function extractRefundInfo(userMessage) {
  const prompt = `
Extract the customer email and order ID from this refund request.

Return ONLY valid JSON. No markdown. No explanation.

Format:
{
  "customerEmail": "string or null",
  "orderId": "string or null"
}

Customer message:
${userMessage}
`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt
  });

  const text = response.text.trim();
  const cleaned = text.replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const emailMatch = userMessage.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    const orderMatch = userMessage.match(/ORD-\d+/i);

    return {
      customerEmail: emailMatch ? emailMatch[0] : null,
      orderId: orderMatch ? orderMatch[0].toUpperCase() : null
    };
  }
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
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt
      });

      return {
        text: response.text.trim(),
        usageMetadata: response.usageMetadata || null
      };
    } catch (error) {
      console.error(
        `Gemini generateCustomerResponse attempt ${attempt} failed:`,
        error.message
      );

      if (attempt === 3) {
        throw error;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, attempt * 2000)
      );
    }
  }
}