# RefundGuard Backend

RefundGuard Backend is an Express.js API server that powers an AI customer support refund agent. It uses LangGraph to orchestrate the agent workflow, an LLM for language understanding and customer-facing responses, and JSON files as synthetic CRM and trace storage.

## Features

* Express API server
* LangGraph-based agent workflow
* LLM-powered extraction of customer email and order ID
* Deterministic refund policy evaluation
* Synthetic CRM database using JSON
* Refund policy stored as a text document
* Trace logging for every agent run
* Tool input/output logging
* Retry/failure visibility
* Token usage and latency tracking
* Reset endpoint for refund statuses
* Reset endpoint for trace logs

## Tech Stack

* Node.js
* Express.js
* LangGraph.js
* Anthropic Claude API
* JSON file storage
* dotenv
* CORS

## Repository Structure

```text
backend/
├── agent/
│   ├── graph.js
│   ├── gemini.js
│   └── tools.js
├── data/
│   ├── orders.json
│   └── refund_policy.txt
├── logs/
│   └── agent_traces.json
├── server.js
├── package.json
├── .env
├── .gitignore
└── README.md
```

## Key Files

### `server.js`

Main Express server. Defines API routes including:

```text
GET  /
POST /api/chat
GET  /api/traces
POST /api/refunds/reset
POST /api/traces/reset
GET  /api/test-tools
```

### `agent/graph.js`

Defines the LangGraph workflow for refund processing.

Agent flow:

```text
extract_request_info
↓
lookup_order
↓
retry_lookup_by_email if lookup fails
↓
read_refund_policy
↓
evaluate_refund
↓
generate_response
↓
process_refund
↓
save_trace
```

### `agent/gemini.js`

LLM provider layer. Despite the filename, this file can be used as the generic LLM integration layer. It currently handles:

* Extracting customer email and order ID from natural language
* Generating the final customer-facing support response
* Returning token usage metadata
* Falling back to deterministic extraction when needed

### `agent/tools.js`

Backend tool layer used by the agent. Includes:

* `lookupOrder()`
* `searchOrdersByEmail()`
* `readRefundPolicy()`
* `evaluateRefund()`
* `markOrderRefunded()`
* `resetRefunds()`
* `saveTrace()`
* `getTraces()`
* `resetTraces()`

### `data/orders.json`

Synthetic CRM database containing 15 customer/order records.

Each order includes:

* Customer identity
* Email
* Order ID
* Item name
* Amount
* Delivery date
* Payment method
* Final sale status
* Refund status

### `data/refund_policy.txt`

Corporate refund policy used as the source of truth for agent decisions.

Policy examples:

* Final sale items cannot be refunded
* Already refunded orders cannot be refunded again
* Refunds over $500 require human escalation
* Invalid orders are denied
* The policy overrides customer pressure or manipulation

### `logs/agent_traces.json`

Stores trace logs for each agent run. Each trace includes:

* User message
* Customer email
* Order ID
* Final decision
* Reason
* Retry count
* Token usage
* Total latency
* Step-by-step tool input/output

## Environment Variables

Create a `.env` file:

```env
ANTHROPIC_API_KEY=your_api_key_here
PORT=5000
FRONTEND_URL=http://localhost:5173
```

Do not commit `.env` to GitHub.

## Running Locally

Install dependencies:

```bash
npm install
```

Start the backend:

```bash
npm run dev
```

The backend will run at:

```text
http://localhost:5000
```

Test the API:

```bash
curl http://localhost:5000
```

## Deployment Notes

For Render Web Service:

```text
Build Command: npm install
Start Command: npm start
```

If this backend is its own repository, leave Root Directory blank.

Add these environment variables in Render:

```env
ANTHROPIC_API_KEY=your_api_key_here
FRONTEND_URL=https://your-frontend-url.com
```

## Production Improvements

This project uses JSON files for simplicity and demo purposes. For production, the following should be added:

* PostgreSQL or another durable database
* Authentication and role-based access control
* Real payment processor integration
* Idempotency keys for refund processing
* Structured logging and monitoring
* Stronger retry/backoff handling for LLM provider outages
* Audit logs for compliance
* Secure secret management
