import Koa from "koa";
import Router from "@koa/router";
import bodyParser from "koa-bodyparser";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { InMemoryEventStore } from "@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"
import { Context } from "koa";
import logger, { requestLogger } from "./logger.js";

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

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

    // Add CORS headers for Cloud Run
    app.use(async (ctx, next) => {
      ctx.set('Access-Control-Allow-Origin', '*');
      ctx.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      ctx.set('Access-Control-Allow-Headers', 'Content-Type, Accept, mcp-session-id, last-event-id');
      ctx.set('Connection', 'keep-alive');
      ctx.set('Cache-Control', 'no-cache');
      ctx.set('X-Content-Type-Options', 'nosniff');
      ctx.set('X-Frame-Options', 'DENY');
      
      if (ctx.method === 'OPTIONS') {
        ctx.status = 200;
        return;
      }
      
      await next();
    });

    // Add request logging middleware
    app.use(requestLogger);

    // Add error handling middleware
    app.use(async (ctx, next) => {
      try {
        await next();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        logger.error('Unhandled error', { error: errorMessage, stack: errorStack });
        ctx.status = 500;
        ctx.body = { error: 'Internal server error' };
      }
    });

    // Map to store transports by session ID
    const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

    // Handle POST requests for client-to-server communication
    router.post('/mcp', async (ctx: Context) => {
      logger.info('MCP POST Request received', { 
        method: ctx.method, 
        url: ctx.url,
        sessionId: ctx.headers['mcp-session-id'],
        contentType: ctx.headers['content-type']
      });
      
      try {
        // Check for existing session ID
        const sessionId = ctx.headers['mcp-session-id'] as string | undefined;
        let transport: StreamableHTTPServerTransport;
        
        if (sessionId && transports[sessionId]) {
          // Reuse existing transport
          transport = transports[sessionId];
        } else if (!sessionId && isInitializeRequest(ctx.request.body)) {
          // New initialization request
          const eventStore = new InMemoryEventStore();
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            enableJsonResponse: true,
            eventStore,
            onsessioninitialized: (sessionId) => {
              transports[sessionId] = transport;
            }
          });

          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid && transports[sid]) {
              delete transports[sid];
            }
          };

          await server.connect(transport);
          await transport.handleRequest(ctx.req, ctx.res, ctx.request.body);
          
          if (transport.sessionId) {
            ctx.set('mcp-session-id', transport.sessionId);
          }
          
          // Ensure proper response headers for MCP protocol
          if (!ctx.res.headersSent) {
            ctx.set('Content-Type', 'application/json');
            ctx.set('Connection', 'keep-alive');
          }
          
          ctx.respond = false;
          return;
        } else if (sessionId && !transports[sessionId]) {
          // Create new transport for provided session ID
          const eventStore = new InMemoryEventStore();
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => sessionId,
            enableJsonResponse: true,
            eventStore,
            onsessioninitialized: (sid) => {
              transports[sid] = transport;
            }
          });

          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid && transports[sid]) {
              delete transports[sid];
            }
          };

          await server.connect(transport);
          transports[sessionId] = transport;
        } else if (!sessionId && !isInitializeRequest(ctx.request.body)) {
          // No session ID and not an initialization request - this is an error
          logger.warn('Invalid request: No session ID and not an initialization request', {
            method: ctx.method,
            url: ctx.url,
            requestBody: ctx.request.body
          });
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

        await transport.handleRequest(ctx.req, ctx.res, ctx.request.body);
        ctx.respond = false;
        return;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        logger.error('Error handling MCP request', { 
          error: errorMessage, 
          stack: errorStack,
          method: ctx.method,
          url: ctx.url,
          sessionId: ctx.headers['mcp-session-id']
        });
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
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        logger.error('Error handling GET request', { 
          error: errorMessage, 
          stack: errorStack,
          method: ctx.method,
          url: ctx.url,
          sessionId: ctx.headers['mcp-session-id']
        });
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
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        logger.error('Error handling DELETE request', { 
          error: errorMessage, 
          stack: errorStack,
          method: ctx.method,
          url: ctx.url,
          sessionId: ctx.headers['mcp-session-id']
        });
        if (!ctx.res.headersSent) {
          ctx.status = 500;
          ctx.body = 'Error processing session termination';
        }
      }
    });

    // Add health check endpoint for Cloud Run
    const healthCheckPath = process.env.HEALTH_CHECK_PATH || '/health';
    
    // Handle both correct and typo paths for health checks
    const healthCheckHandler = async (ctx: Context) => {
      logger.info('Health check request received', { 
        method: ctx.method, 
        url: ctx.url, 
        path: ctx.path,
        headers: ctx.headers,
        ip: ctx.ip
      });
      
      try {
        // Always return 200 for health checks to prevent instance shutdown
        ctx.status = 200;
        ctx.set('Content-Type', 'application/json');
        ctx.set('Connection', 'keep-alive');
        ctx.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        ctx.body = { 
          status: 'ok', 
          timestamp: new Date().toISOString(),
          service: 'streamable-mcp-server',
          version: '1.0.0',
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          endpoints: {
            mcp: '/mcp',
            health: '/health'
          }
        };
        logger.info('Health check request handled successfully', { 
          status: ctx.status, 
          uptime: process.uptime() 
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Health check error', { error: errorMessage });
        // Even on error, return 200 to prevent instance shutdown
        ctx.status = 200;
        ctx.set('Content-Type', 'application/json');
        ctx.body = { 
          status: 'error', 
          message: 'Health check failed',
          timestamp: new Date().toISOString(),
          uptime: process.uptime()
        };
      }
    };

    // Register health check routes for both correct and typo paths
    router.get(healthCheckPath, healthCheckHandler);

    // Add root endpoint for basic connectivity testing
    router.get('/', async (ctx: Context) => {
      ctx.status = 200;
      ctx.set('Content-Type', 'application/json');
      ctx.set('Connection', 'keep-alive');
      ctx.body = { 
        message: 'MCP Streamable HTTP Server is running',
        status: 'ready',
        uptime: process.uptime(),
        endpoints: {
          health: '/health',
          mcp: '/mcp',
          test: '/test-mcp'
        },
        timestamp: new Date().toISOString()
      };
    });

    // Add favicon endpoint to prevent 404s
    router.get('/favicon.ico', async (ctx: Context) => {
      ctx.status = 204; // No content
      ctx.set('Content-Type', 'image/x-icon');
    });

    // Use router middleware
    app.use(router.routes());
    app.use(router.allowedMethods()); // Re-enabled for proper routing

    // Start HTTP server - bind to all interfaces for Cloud Run
    logger.info('Starting HTTP server for TCP health checks', { port: PORT, host: HOST });
    
    // Create server that can handle both HTTP/1.1 and HTTP/2
    // Use app.listen directly which handles HTTP/2 properly in Cloud Run
    // For TCP health checks, we just need the server to be listening on the port
    logger.info('About to start listening on port', { port: PORT, host: HOST });
    
    const httpServer = app.listen(Number(PORT), HOST, () => {
      logger.info('MCP Streamable HTTP Server started', {
        port: PORT,
        host: HOST,
        environment: process.env.NODE_ENV || 'development',
        processId: process.pid,
        uptime: process.uptime(),
        memory: process.memoryUsage()
      });
      
      // Log that the server is ready to accept requests
      logger.info('Server is ready to accept requests', {
        port: PORT,
        host: HOST,
        healthEndpoint: `http://${HOST}:${PORT}/health`,
        mcpEndpoint: `http://${HOST}:${PORT}/mcp`,
        startupEndpoint: `http://${HOST}:${PORT}/startup`
      });
    }).on('error', (error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to start HTTP server', { 
        error: errorMessage, 
        port: PORT,
        host: HOST,
        code: error instanceof Error ? (error as any).code : undefined,
        stack: error instanceof Error ? error.stack : undefined
      });
      process.exit(1);
    });

    // Add error handling for uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception', { 
        error: error.message, 
        stack: error.stack 
      });
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection', { 
        reason: reason, 
        promise: promise 
      });
      process.exit(1);
    });

    // Add error handling for the HTTP server
    httpServer.on('error', (error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('HTTP Server error', { error: errorMessage });
    });

    httpServer.on('connection', (socket) => {
      logger.info('New connection', { 
        remoteAddress: socket.remoteAddress, 
        remotePort: socket.remotePort 
      });
    });

    const instance: ServerInstance = {
      process,
      server,
      httpServer
    };

    // Handle server shutdown
    const gracefulShutdown = async (signal: string) => {
      logger.info('Received shutdown signal', { signal });
      
      // Close all active transports to properly clean up resources
      for (const sessionId in transports) {
        try {
          logger.info('Closing transport', { sessionId });
          await transports[sessionId].close();
          delete transports[sessionId];
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error('Error closing transport', { sessionId, error: errorMessage });
        }
      }
      
      await instance.httpServer.close();
      await server.close();
      logger.info('Server shutdown complete');
      process.exit(0);
    };

    // Handle various shutdown signals
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // nodemon restart

    return instance;
  };

  return { server, start };
};
