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
      console.log(`=== MCP POST Request received: ${ctx.method} ${ctx.url} ===`);
      console.log(`Request path: ${ctx.path}`);
      console.log(`Request method: ${ctx.method}`);
      console.log('Headers:', JSON.stringify(ctx.headers, null, 2));
      console.log('Body:', JSON.stringify(ctx.request.body, null, 2));
      console.log('URL:', ctx.url);
      console.log('Path:', ctx.path);
      
      try {
        // Check for existing session ID
        const sessionId = ctx.headers['mcp-session-id'] as string | undefined;
        let transport: StreamableHTTPServerTransport;
        
        console.log(`Session ID from header: ${sessionId}`);
        console.log(`Available sessions: ${Object.keys(transports).join(', ')}`);
        console.log(`Session exists: ${sessionId ? transports[sessionId] ? 'yes' : 'no' : 'no session ID'}`);

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
          
          // Return the session ID in the response headers for the MCP Inspector
          if (transport.sessionId) {
            ctx.set('mcp-session-id', transport.sessionId);
          }
          ctx.respond = false; // Tell Koa not to send its own response
          return; // Already handled
        } else if (sessionId && !transports[sessionId]) {
          // Session ID provided but not found - create a new transport for this session
          console.log(`Creating new transport for provided session ID: ${sessionId}`);
          const eventStore = new InMemoryEventStore();
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => sessionId, // Use the provided session ID
            enableJsonResponse: true,
            eventStore,
            onsessioninitialized: (sid) => {
              // Store the transport by session ID when session is initialized
              // This avoids race conditions where requests might come in before the session is stored
              console.log(`Session initialized with provided ID: ${sid}`);
              transports[sid] = transport;
            }
          });

          // Set up onclose handler to clean up transport when closed
          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid && transports[sid]) {
              console.log(`Transport closed for session ${sid}, removing from transports map`);
              delete transports[sid];
            }
          };

          // Connect the transport to the MCP server BEFORE handling the request
          // so responses can flow back through the same transport
          console.log(`Connecting transport to MCP server for session ${sessionId}...`);
          await server.connect(transport);
          console.log(`Transport connected to MCP server successfully for session ${sessionId}`);
          
          // Store the transport
          transports[sessionId] = transport;
        } else if (!sessionId && !isInitializeRequest(ctx.request.body)) {
          // No session ID and not an initialization request - this is an error
          console.error('Invalid request: No session ID and not an initialization request');
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
        ctx.respond = false; // Tell Koa not to send its own response
        return;
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

    // Add health check endpoint for Cloud Run
    router.get('/health', async (ctx: Context) => {
      try {
        ctx.status = 200;
        ctx.body = { 
          status: 'ok', 
          timestamp: new Date().toISOString(),
          service: 'streamable-mcp-server',
          version: '1.0.0'
        };
        console.log('Health check request handled successfully');
      } catch (error) {
        console.error('Health check error:', error);
        ctx.status = 500;
        ctx.body = { 
          status: 'error', 
          message: 'Health check failed',
          timestamp: new Date().toISOString()
        };
      }
    });

    // Add root endpoint for basic connectivity testing
    router.get('/', async (ctx: Context) => {
      ctx.status = 200;
      ctx.body = { 
        message: 'MCP Streamable HTTP Server is running',
        endpoints: {
          health: '/health',
          mcp: '/mcp'
        },
        timestamp: new Date().toISOString()
      };
    });

    // Add a test route to debug routing
    router.post('/test-mcp', async (ctx: Context) => {
      console.log('=== TEST MCP ROUTE HIT ===');
      ctx.status = 200;
      ctx.body = { message: 'Test MCP route works' };
    });

    // Use router middleware
    app.use(router.routes());
    app.use(router.allowedMethods()); // Re-enabled for proper routing

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
