# Norce Commerce Agent SDK

Norce Commerce Agent SDK - A Node.js 20 + TypeScript application with Fastify, OpenAI, and Norce API integration.

## Features

- **Fastify Server**: High-performance web framework
- **OpenAI Integration**: AI-powered chat agent
- **Norce API**: Commerce platform integration
- **Session Management**: Pluggable session storage (in-memory or Redis)
- **TypeScript**: Type-safe development
- **Vitest**: Fast unit testing

## Prerequisites

- Node.js 20 or higher
- npm or yarn

## Installation

```bash
npm install
```

## Configuration

Copy the `.env.example` file to `.env` and configure your environment variables:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```
PORT=3000
NODE_ENV=development
NORCE_API_URL=https://api.norce.tech
NORCE_CLIENT_ID=your_client_id_here
NORCE_CLIENT_SECRET=your_client_secret_here
OPENAI_API_KEY=your_openai_api_key_here
```

## Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Start production server
- `npm test` - Run tests with Vitest
- `npm run lint` - Run ESLint

## API Endpoints

### POST /v1/chat

Send a chat message to the AI agent.

**Request:**
```json
{
  "message": "Hello, what products do you have?",
  "sessionId": "optional-session-id"
}
```

**Response:**
```json
{
  "sessionId": "generated-or-provided-session-id",
  "message": "I can help you search for products...",
  "timestamp": "2026-01-01T19:00:00.000Z"
}
```

### GET /v1/health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-01-01T19:00:00.000Z"
}
```

## Project Structure

```
src/
├── __tests__/          # Test files
├── agent/              # AI agent logic
│   ├── runner.ts       # OpenAI agent runner
│   └── tools.ts        # Agent tools definition
├── norce/              # Norce API integration
│   ├── McpClient.ts    # MCP client
│   └── TokenProvider.ts # OAuth token provider
├── routes/             # API routes
│   └── chat.ts         # Chat endpoint
├── session/            # Session management
│   ├── ISessionStore.ts           # Session store interface
│   └── InMemorySessionStore.ts    # In-memory implementation
├── config.ts           # Configuration management
└── server.ts           # Main server file
```

## Testing with Postman

### Option 1: Import Collection

Import the `postman_collection.json` file into Postman to get pre-configured requests.

### Option 2: Manual Setup

1. Start the server: `npm run dev`
2. Create a POST request to `http://localhost:3000/v1/chat`
3. Set the request body:
   ```json
   {
     "message": "Hello, can you help me find products?"
   }
   ```
4. Send the request and receive a response with a sessionId
5. Continue the conversation by including the sessionId in subsequent requests

## Development

The application uses:
- **Fastify** for the web server
- **OpenAI** for AI-powered responses
- **Zod** for schema validation
- **Pino** for logging
- **Undici** for HTTP requests
- **tsx** for TypeScript execution in development

## License

MIT
