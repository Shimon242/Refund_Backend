import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { v4 as uuidv4 } from "uuid";
import {
  extractRefundInfo,
  generateCustomerResponse
} from "./gemini.js";

import {
  lookupOrder,
  searchOrdersByEmail,
  readRefundPolicy,
  evaluateRefund,
  saveTrace,
  markOrderRefunded
} from "./tools.js";

const RefundState = Annotation.Root({
  userMessage: Annotation(),
  customerEmail: Annotation(),
  orderId: Annotation(),
  order: Annotation(),
  policy: Annotation(),
  decision: Annotation(),
  reason: Annotation(),
  response: Annotation(),
  tokenUsage: Annotation({
    reducer: (left = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, right = {}) => ({
      prompt_tokens: left.prompt_tokens + (right.prompt_tokens || 0),
      completion_tokens: left.completion_tokens + (right.completion_tokens || 0),
      total_tokens: left.total_tokens + (right.total_tokens || 0)
    }),
    default: () => ({
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    })
  }),
  traceSteps: Annotation({
    reducer: (left = [], right = []) => left.concat(right),
    default: () => []
  }),
  retryCount: Annotation({
    reducer: (left = 0, right = 0) => left + right,
    default: () => 0
  }),
  startedAt: Annotation(),
  totalLatencyMs: Annotation()
});

async function extractRequestInfo(state) {
  const started = Date.now();

  try {
    const result = await extractRefundInfo(state.userMessage);

    return {
      customerEmail: result.customerEmail,
      orderId: result.orderId?.toUpperCase() || null,
      traceSteps: [
        {
          step: "gemini_extract_request_info",
          input: {
            userMessage: state.userMessage
          },
          output: result,
          success: Boolean(result.customerEmail && result.orderId),
          latency_ms: Date.now() - started
        }
      ]
    };
  } catch (error) {
    return {
      customerEmail: null,
      orderId: null,
      traceSteps: [
        {
          step: "gemini_extract_request_info",
          input: {
            userMessage: state.userMessage
          },
          output: {
            error: error.message
          },
          success: false,
          latency_ms: Date.now() - started
        }
      ]
    };
  }
}

async function lookupOrderNode(state) {
  const started = Date.now();

  const result = await lookupOrder(state.customerEmail, state.orderId);

  return {
    order: result.success ? result.order : null,
    traceSteps: [
      {
        step: "lookup_order",
        input: {
          email: state.customerEmail,
          order_id: state.orderId
        },
        output: result,
        success: result.success,
        latency_ms: Date.now() - started
      }
    ]
  };
}

async function retryLookupNode(state) {
  const started = Date.now();

  const result = await searchOrdersByEmail(state.customerEmail);

  return {
    order: null,
    retryCount: 1,
    traceSteps: [
      {
        step: "retry_lookup_by_email",
        input: {
          email: state.customerEmail,
          requested_order_id: state.orderId
        },
        output: {
          success: result.success,
          matching_order_ids: result.orders?.map((order) => order.order_id) || [],
          note: "Email matched, but requested order ID was not found. Agent should not switch to a different order automatically."
        },
        success: false,
        latency_ms: Date.now() - started
      }
    ]
  };
}

async function readPolicyNode() {
  const started = Date.now();

  const result = await readRefundPolicy();

  return {
    policy: result.policy,
    traceSteps: [
      {
        step: "read_refund_policy",
        input: {},
        output: {
          success: result.success,
          policy_preview: result.policy.slice(0, 250)
        },
        success: result.success,
        latency_ms: Date.now() - started
      }
    ]
  };
}

function evaluateRefundNode(state) {
  const started = Date.now();

  const result = evaluateRefund(state.order);

  return {
    decision: result.decision,
    reason: result.reason,
    traceSteps: [
      {
        step: "evaluate_refund",
        input: {
          order_id: state.order?.order_id || state.orderId,
          amount: state.order?.amount,
          final_sale: state.order?.final_sale,
          refunded: state.order?.refunded,
          delivery_date: state.order?.delivery_date
        },
        output: result,
        success: true,
        latency_ms: Date.now() - started
      }
    ]
  };
}

async function processRefundNode(state) {
  const started = Date.now();

  try {
    if (state.decision !== "APPROVED") {
      return {
        traceSteps: [
          {
            step: "process_refund",
            input: {
              decision: state.decision,
              order_id: state.order?.order_id || state.orderId
            },
            output: {
              processed: false,
              reason: "Refund was not approved, so no order update was performed."
            },
            success: true,
            latency_ms: Date.now() - started
          }
        ]
      };
    }

    if (!state.order?.order_id) {
      return {
        traceSteps: [
          {
            step: "process_refund",
            input: {
              decision: state.decision,
              order_id: state.orderId
            },
            output: {
              processed: false,
              error: "Approved decision but no valid order ID was available."
            },
            success: false,
            latency_ms: Date.now() - started
          }
        ]
      };
    }

    const result = await markOrderRefunded(state.order.order_id);

    return {
      order: {
        ...state.order,
        refunded: true,
        refund_status: "approved",
        refunded_at: new Date().toISOString()
      },
      traceSteps: [
        {
          step: "process_refund",
          input: {
            decision: state.decision,
            order_id: state.order.order_id
          },
          output: result,
          success: result.success,
          latency_ms: Date.now() - started
        }
      ]
    };
  } catch (error) {
    console.error("processRefundNode failed:", error);

    return {
      traceSteps: [
        {
          step: "process_refund",
          input: {
            decision: state.decision,
            order_id: state.order?.order_id || state.orderId
          },
          output: {
            error: error.message
          },
          success: false,
          latency_ms: Date.now() - started
        }
      ]
    };
  }
}

async function generateResponseNode(state) {
  const started = Date.now();

  try {
    const result = await generateCustomerResponse({
      decision: state.decision,
      reason: state.reason,
      order: state.order,
      orderId: state.orderId
    });

    const usage = result.usageMetadata || {};

    return {
      response: result.text,
      tokenUsage: {
        prompt_tokens: usage.promptTokenCount || 0,
        completion_tokens: usage.candidatesTokenCount || 0,
        total_tokens: usage.totalTokenCount || 0
      },
      traceSteps: [
        {
          step: "gemini_generate_response",
          input: {
            decision: state.decision,
            reason: state.reason,
            order_id: state.order?.order_id || state.orderId
          },
          output: {
            response: result.text,
            usageMetadata: result.usageMetadata
          },
          success: true,
          latency_ms: Date.now() - started
        }
      ]
    };
  } catch (error) {
    const fallbackResponse = `${state.decision}

Order: ${state.order?.order_id || state.orderId || "unknown"}

Reason: ${state.reason}`;

    return {
      response: fallbackResponse,
      traceSteps: [
        {
          step: "gemini_generate_response",
          input: {
            decision: state.decision,
            reason: state.reason
          },
          output: {
            error: error.message,
            fallback_response: fallbackResponse
          },
          success: false,
          latency_ms: Date.now() - started
        }
      ]
    };
  }
}

async function saveTraceNode(state) {
  const totalLatencyMs = Date.now() - state.startedAt;

  const trace = {
    trace_id: uuidv4(),
    timestamp: new Date().toISOString(),
    customer_email: state.customerEmail,
    order_id: state.order?.order_id || state.orderId,
    user_message: state.userMessage,
    steps: state.traceSteps,
    final_decision: state.decision,
    reason: state.reason,
    retry_count: state.retryCount,
    token_usage: state.tokenUsage,
    total_latency_ms: totalLatencyMs
  };

  await saveTrace(trace);

  return {
    totalLatencyMs,
    traceSteps: [
      {
        step: "save_trace",
        input: {
          trace_id: trace.trace_id
        },
        output: {
          saved: true
        },
        success: true,
        latency_ms: 0
      }
    ]
  };
}

function shouldRetryLookup(state) {
  if (!state.order && state.customerEmail && state.retryCount === 0) {
    return "retry";
  }

  return "continue";
}

const workflow = new StateGraph(RefundState)
  .addNode("extract_request_info", extractRequestInfo)
  .addNode("lookup_order", lookupOrderNode)
  .addNode("retry_lookup", retryLookupNode)
  .addNode("read_policy", readPolicyNode)
  .addNode("evaluate_refund", evaluateRefundNode)
  .addNode("process_refund", processRefundNode)
  .addNode("generate_response", generateResponseNode)
  .addNode("save_trace", saveTraceNode)
  .addEdge(START, "extract_request_info")
  .addEdge("extract_request_info", "lookup_order")
  .addConditionalEdges("lookup_order", shouldRetryLookup, {
    retry: "retry_lookup",
    continue: "read_policy"
  })
  .addEdge("retry_lookup", "read_policy")
  .addEdge("read_policy", "evaluate_refund")
  .addEdge("evaluate_refund", "generate_response")
  .addEdge("generate_response", "process_refund")
  .addEdge("process_refund", "save_trace")
  .addEdge("save_trace", END);

export const refundGraph = workflow.compile();

export async function runRefundAgent(userMessage) {
  const result = await refundGraph.invoke({
    userMessage,
    startedAt: Date.now(),
    traceSteps: [],
    retryCount: 0
  });

  return {
    response: result.response,
    decision: result.decision,
    reason: result.reason,
    order_id: result.order?.order_id || result.orderId,
    customer_email: result.customerEmail,
    retry_count: result.retryCount,
    latency_ms: result.totalLatencyMs,
    token_usage: result.tokenUsage
  };
}