import Koa from "koa";
import Router from "@koa/router";
import bodyParser from "koa-bodyparser";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { InMemoryEventStore } from "@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"
import { Context } from "koa";

const PORT = process.env.PORT || 3000;

interface ServerOptions {
  name: string;
}

interface ServerInstance {
  process: NodeJS.Process;
  server: McpServer;
  httpServer: any;
}

// Example: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/src/examples/server/sseAndStreamableHttpCompatibleServer.ts
export const createMcpServer = (options: ServerOptions): { server: McpServer; start: () => ServerInstance } => {
  const server = new McpServer({
    name: options.name,
    version: "1.0.0",
  }, {
    capabilities: {
      logging: {},
      tools: {
        listChanged: false
      }
    }
  });

  const start = (): ServerInstance => {
    const app = new Koa();
    const router = new Router();

    // Use body parser middleware
    app.use(bodyParser());

    // Map to store transports by session ID
    const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

    // Handle POST requests for client-to-server communication
    router.post('/mcp', async (ctx: Context) => {
      console.log(`Request received: ${ctx.method} ${ctx.url}`, { body: ctx.request.body });
      
      try {
        // Check for existing session ID
        const sessionId = ctx.headers['mcp-session-id'] as string | undefined;
        let transport: StreamableHTTPServerTransport;

        if (sessionId && transports[sessionId]) {
          // Reuse existing transport
          console.log(`Reusing session: ${sessionId}`);
          transport = transports[sessionId];
        } else if (!sessionId && isInitializeRequest(ctx.request.body)) {
          console.log(`New session request: ${ctx.request.body.method}`);
          // New initialization request
          const eventStore = new InMemoryEventStore();
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            enableJsonResponse: true,
            eventStore, // Enable resumability
            onsessioninitialized: (sessionId) => {
              // Store the transport by session ID
              console.log(`Session initialized: ${sessionId}`);
              transports[sessionId] = transport;
            }
          });

          // Clean up transport when closed
          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid && transports[sid]) {
              console.log(`Transport closed for session ${sid}, removing from transports map`);
              delete transports[sid];
            }
          };

          // Connect to the MCP server BEFORE handling the request
          console.log(`Connecting transport to MCP server...`);
          await server.connect(transport);
          console.log(`Transport connected to MCP server successfully`);
          
          console.log(`Handling initialization request...`);
          await transport.handleRequest(ctx.req, ctx.res, ctx.request.body);
          console.log(`Initialization request handled, response sent`);
          return; // Already handled
        } else {
          console.error('Invalid request: No valid session ID or initialization request');
          // Invalid request
          ctx.status = 400;
          ctx.body = {
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Bad Request: No valid session ID provided',
            },
            id: null,
          };
          return;
        }

        console.log(`Handling request for session: ${transport.sessionId}`);
        console.log(`Request body:`, JSON.stringify(ctx.request.body, null, 2));
        
        // Handle the request with existing transport
        console.log(`Calling transport.handleRequest...`);
        const startTime = Date.now();
        await transport.handleRequest(ctx.req, ctx.res, ctx.request.body);
        const duration = Date.now() - startTime;
        console.log(`Request handling completed in ${duration}ms for session: ${transport.sessionId}`);
      } catch (error) {
        console.error('Error handling MCP request:', error);
        if (!ctx.res.headersSent) {
          ctx.status = 500;
          ctx.body = {
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'Internal server error',
            },
            id: null,
          };
        }
      }
    });

    // Handle GET requests for server-to-client notifications via SSE
    router.get('/mcp', async (ctx: Context) => {
      console.log(`GET Request received: ${ctx.method} ${ctx.url}`);
      
      try {
        const sessionId = ctx.headers['mcp-session-id'] as string | undefined;
        if (!sessionId || !transports[sessionId]) {
          console.log(`Invalid session ID in GET request: ${sessionId}`);
          ctx.status = 400;
          ctx.body = 'Invalid or missing session ID';
          return;
        }
        
        // Check for Last-Event-ID header for resumability
        const lastEventId = ctx.headers['last-event-id'] as string | undefined;
        if (lastEventId) {
          console.log(`Client reconnecting with Last-Event-ID: ${lastEventId}`);
        } else {
          console.log(`Establishing new SSE stream for session ${sessionId}`);
        }
        
        const transport = transports[sessionId];
        
        // Set up connection close monitoring
        ctx.res.on('close', () => {
          console.log(`SSE connection closed for session ${sessionId}`);
        });
        
        console.log(`Starting SSE transport.handleRequest for session ${sessionId}...`);
        const startTime = Date.now();
        await transport.handleRequest(ctx.req, ctx.res);
        const duration = Date.now() - startTime;
        console.log(`SSE stream setup completed in ${duration}ms for session: ${sessionId}`);
      } catch (error) {
        console.error('Error handling GET request:', error);
        if (!ctx.res.headersSent) {
          ctx.status = 500;
          ctx.body = 'Internal server error';
        }
      }
    });

    // Handle DELETE requests for session termination
    router.delete('/mcp', async (ctx: Context) => {
      console.log(`DELETE Request received: ${ctx.method} ${ctx.url}`);
      try {
        const sessionId = ctx.headers['mcp-session-id'] as string | undefined;
        if (!sessionId || !transports[sessionId]) {
          console.log(`Invalid session ID in DELETE request: ${sessionId}`);
          ctx.status = 400;
          ctx.body = 'Invalid or missing session ID';
          return;
        }
        
        console.log(`Received session termination request for session ${sessionId}`);
        const transport = transports[sessionId];
        
        console.log(`Processing session termination...`);
        const startTime = Date.now();
        await transport.handleRequest(ctx.req, ctx.res);
        const duration = Date.now() - startTime;
        console.log(`Session termination completed in ${duration}ms for session: ${sessionId}`);
        
        // Check if transport was actually closed
        setTimeout(() => {
          if (transports[sessionId]) {
            console.log(`Note: Transport for session ${sessionId} still exists after DELETE request`);
          } else {
            console.log(`Transport for session ${sessionId} successfully removed after DELETE request`);
          }
        }, 100);
      } catch (error) {
        console.error('Error handling DELETE request:', error);
        if (!ctx.res.headersSent) {
          ctx.status = 500;
          ctx.body = 'Error processing session termination';
        }
      }
    });

    // Use router middleware
    app.use(router.routes());
    app.use(router.allowedMethods());

    // Start HTTP server
    const httpServer = app.listen(PORT, () => {
      console.log(`MCP Streamable HTTP Server listening on port ${PORT}`);
    });

    const instance: ServerInstance = {
      process,
      server,
      httpServer
    };

    // Handle server shutdown
    process.on('SIGINT', async () => {
      console.log('Shutting down server...');

      // Close all active transports to properly clean up resources
      for (const sessionId in transports) {
        try {
          console.log(`Closing transport for session ${sessionId}`);
          await transports[sessionId].close();
          delete transports[sessionId];
        } catch (error) {
          console.error(`Error closing transport for session ${sessionId}:`, error);
        }
      }
      
      await instance.httpServer.close();
      await server.close();
      console.log('Server shutdown complete');
      process.exit(0);
    });

    return instance;
  };

  return { server, start };
};
