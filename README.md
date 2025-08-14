[![MSeeP.ai Security Assessment Badge](https://mseep.net/pr/jerrytohvan-typescript-koa-mcp-server-starter-badge.png)](https://mseep.ai/app/jerrytohvan-typescript-koa-mcp-server-starter)

# TypeScript MCP Server Starter

A Model Context Protocol (MCP) server starter built with TypeScript, supporting Streamable-HTTP transport. This project uses Koa for the HTTP server implementation and provides a solid foundation for building MCP servers.

> **Inspired by**: This starter project is inspired by the [official MCP TypeScript SDK example](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/src/examples/server/sseAndStreamableHttpCompatibleServer.ts) from the Model Context Protocol team.

## Features

- **Streamable-HTTP Transport**: Full support for MCP Streamable-HTTP protocol
- **Koa-based HTTP Server**: Modern, lightweight HTTP server using Koa and @koa/router
- **Session Management**: Full session lifecycle management with resumability support
- **TypeScript**: Fully typed with comprehensive type definitions
- **Development Tools**: Hot reloading, TypeScript compilation, and debugging support
- **@modelcontextprotocol/sdk** (v1.10.1) - Official MCP SDK for building protocol-compliant servers


## Installation

This project uses Yarn as the package manager. To install dependencies:

```bash
yarn install
```

## Building the Project

To build the TypeScript code:

```bash
yarn build
```

## Running the Server

### Production Mode

To run the server in production mode:

```bash
yarn start
```

The server will start on port 3000 by default. You can customize the port:

```bash
PORT=3002 yarn start
```

### Development Mode

For development with hot reloading:

```bash
yarn dev
```

With a custom port:

```bash
PORT=3002 yarn dev
```

## Testing with MCP Clients

### 1. Start the server
In one terminal, start your MCP server:
```bash
yarn start
```

### 2. Test with MCP Inspector
In a separate terminal, test your Streamable-HTTP MCP server using the official MCP Inspector:

```bash
npx @modelcontextprotocol/inspector http://localhost:3000/mcp
```

Or if you're using a custom port:
```bash
npx @modelcontextprotocol/inspector http://localhost:3002/mcp
```

The server runs on `http://localhost:3000/mcp` and supports the Streamable-HTTP transport protocol.

## Optional: Deploy to Google Cloud Run

Want to deploy your MCP server to the cloud? This project includes everything needed for Google Cloud Run deployment:

### Quick Deploy (3 steps):

1. **Install and setup Google Cloud SDK**:
   ```bash
   curl https://sdk.cloud.google.com | bash
   exec -l $SHELL  # or restart terminal
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   ```

2. **Enable required APIs**:
   ```bash
   gcloud services enable cloudbuild.googleapis.com run.googleapis.com containerregistry.googleapis.com
   ```

3. **Deploy from Local**:
   ```bash
   ./deploy.sh
   ```

That's it! The script will build, push, and deploy your server, then give you the public URL.

### Alternative: Manual Deployment

```bash
# Build and push
docker build -t gcr.io/YOUR_PROJECT_ID/streamable-mcp-server .
docker push gcr.io/YOUR_PROJECT_ID/streamable-mcp-server

# Deploy
gcloud run deploy streamable-mcp-server \
  --image gcr.io/YOUR_PROJECT_ID/streamable-mcp-server \
  --platform managed --region us-central1 \
  --allow-unauthenticated --port 3000
```

For detailed deployment instructions, see the [Deployment to Google Cloud Run](#deployment-to-google-cloud-run) section below.

## Available Tools

The server comes with several example tools:

### `greet`
A simple greeting tool that takes a name parameter.

**Parameters:**
- `name` (string): Name to greet

**Example:**
```json
{
  "name": "greet",
  "arguments": {
    "name": "World"
  }
}
```

### `get_session`
Gets the current session information.

**Parameters:** None

### `multi-greet`
A demonstration tool that sends multiple notifications with delays.

**Parameters:**
- `name` (string): Name to greet

This tool demonstrates:
- Asynchronous operations
- Sending notifications during tool execution
- Multiple response phases

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |

## Project Structure

```
├── src/
│   ├── index.ts          # Main entry point
│   └── server_runner.ts  # Server implementation with Koa
├── build/                # Compiled JavaScript output
├── package.json          # Project dependencies and scripts
└── tsconfig.json         # TypeScript configuration
```

## Development

### Adding New Tools

To add a new tool, modify the server setup in `src/index.ts`:

```typescript
// Create the server
const { server, start } = createMcpServer({
  name: "your-server-name",
});

// Configure tools
server.tool(
  'my-tool',
  'Description of my tool',
  {
    param1: z.string().describe('Description of param1'),
    param2: z.number().describe('Description of param2'),
  },
  async ({ param1, param2 }, { sendNotification }): Promise<CallToolResult> => {
    // Tool implementation
    return {
      content: [
        {
          type: 'text',
          text: `Result: ${param1} and ${param2}`,
        },
      ],
    };
  }
);

// Start the server
const servers = start();
```

## Troubleshooting

### Common Issues

1. **Port already in use**: Change the `PORT` environment variable
2. **TypeScript errors**: Run `yarn build` to check for compilation errors
3. **Client connection issues**: Verify your MCP client is configured to use `http://localhost:3000/mcp`

### Debugging

Enable verbose logging by setting the `DEBUG` environment variable:

```bash
DEBUG=* yarn start
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request


