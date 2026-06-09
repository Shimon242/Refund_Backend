import fs from "fs/promises";
import path from "path";

const ORDERS_PATH = path.join(process.cwd(), "data", "orders.json");
const POLICY_PATH = path.join(process.cwd(), "data", "refund_policy.txt");
const TRACES_PATH = path.join(process.cwd(), "logs", "agent_traces.json");

export async function lookupOrder(email, orderId) {
  const ordersRaw = await fs.readFile(ORDERS_PATH, "utf-8");
  const orders = JSON.parse(ordersRaw);

  const order = orders.find(
    (item) =>
      item.email?.toLowerCase() === email?.toLowerCase() &&
      item.order_id?.toLowerCase() === orderId?.toLowerCase()
  );

  if (!order) {
    return {
      success: false,
      error: "Order not found for the provided email and order ID."
    };
  }

  return {
    success: true,
    order
  };
}

export async function searchOrdersByEmail(email) {
  const ordersRaw = await fs.readFile(ORDERS_PATH, "utf-8");
  const orders = JSON.parse(ordersRaw);

  const matchingOrders = orders.filter(
    (item) => item.email?.toLowerCase() === email?.toLowerCase()
  );

  return {
    success: matchingOrders.length > 0,
    orders: matchingOrders
  };
}

export async function readRefundPolicy() {
  const policy = await fs.readFile(POLICY_PATH, "utf-8");

  return {
    success: true,
    policy
  };
}

export function evaluateRefund(order) {
  if (!order || order.invalid_order) {
    return {
      decision: "DENIED",
      reason: "The order could not be found or is invalid."
    };
  }

  if (order.refunded) {
    return {
      decision: "DENIED",
      reason: "This order has already been refunded."
    };
  }

  if (order.final_sale) {
    return {
      decision: "DENIED",
      reason: "Final sale items are not eligible for refund."
    };
  }

  if (order.amount > 500) {
    return {
      decision: "ESCALATED",
      reason: "Refunds over $500 require human review."
    };
  }

  const deliveryDate = new Date(order.delivery_date);
  const today = new Date();
  const daysSinceDelivery = Math.floor(
    (today - deliveryDate) / (1000 * 60 * 60 * 24)
  );

  if (daysSinceDelivery > 30) {
    return {
      decision: "DENIED",
      reason: `The order was delivered ${daysSinceDelivery} days ago, which is outside the 30-day refund window.`
    };
  }

  return {
    decision: "APPROVED",
    reason: "The order is within the refund window, is not final sale, has not already been refunded, and is under $500."
  };
}

export async function saveTrace(trace) {
  let traces = [];

  try {
    const tracesRaw = await fs.readFile(TRACES_PATH, "utf-8");
    traces = JSON.parse(tracesRaw);
  } catch {
    traces = [];
  }

  traces.unshift(trace);

  await fs.writeFile(TRACES_PATH, JSON.stringify(traces, null, 2));

  return {
    success: true,
    trace_id: trace.trace_id
  };
}

export async function getTraces() {
  try {
    const tracesRaw = await fs.readFile(TRACES_PATH, "utf-8");
    return JSON.parse(tracesRaw);
  } catch {
    return [];
  }
}

export async function markOrderRefunded(orderId) {
  const ordersRaw = await fs.readFile(ORDERS_PATH, "utf-8");
  const orders = JSON.parse(ordersRaw);

  const orderIndex = orders.findIndex(
    (item) => item.order_id?.toLowerCase() === orderId?.toLowerCase()
  );

  if (orderIndex === -1) {
    return {
      success: false,
      error: "Order not found. Could not mark as refunded."
    };
  }

  orders[orderIndex].refunded = true;
  orders[orderIndex].refund_status = "approved";
  orders[orderIndex].refunded_at = new Date().toISOString();

  await fs.writeFile(ORDERS_PATH, JSON.stringify(orders, null, 2));

  return {
    success: true,
    order_id: orderId,
    refunded: true
  };
}

export async function resetRefunds() {
  const ordersRaw = await fs.readFile(ORDERS_PATH, "utf-8");
  const orders = JSON.parse(ordersRaw);

  const updatedOrders = orders.map((order) => ({
    ...order,
    refunded: false,
    refund_status: "not_refunded",
    refunded_at: null
  }));

  await fs.writeFile(ORDERS_PATH, JSON.stringify(updatedOrders, null, 2));

  return {
    success: true,
    message: "All refunds reset to not_refunded.",
    count: updatedOrders.length
  };
}

export async function resetTraces() {
  await fs.writeFile(TRACES_PATH, JSON.stringify([], null, 2));

  return {
    success: true,
    message: "All traces cleared."
  };
}