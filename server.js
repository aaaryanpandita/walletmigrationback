import express, { json } from 'express';
const app = express();
import cors from 'cors';
import walletRoutes from './router/wallet.js';
import config from './config/config.json' assert { type: 'json' };


const stagingConfig = config.development;


// ✅ Swagger imports
import { swaggerUi, swaggerSpec } from "./swagger.js";

// CORS configuration - Allow all origins
app.use(cors({
    origin: '*',
    credentials: false,
    optionsSuccessStatus: 200
}));

app.use(json());

// ✅ Swagger route
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Mount wallet routes
app.use('/wallet', walletRoutes);

/**
 * @swagger
 * /:
 *   get:
 *     summary: Health check root
 *     description: Returns server status
 *     responses:
 *       200:
 *         description: Server is running
 */
app.get('/', (req, res) => {
    res.json({ 
        message: 'Server is running!',
        timestamp: new Date().toISOString(),
        database: 'Connected'
    });
});

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Database health check
 *     description: Returns DB connection status
 *     responses:
 *       200:
 *         description: Database connected
 *       500:
 *         description: Database disconnected
 */
app.get('/health', async (req, res) => {
    try {
        const client = await pool.connect();
        const result = await client.query('SELECT NOW()');
        client.release();
        
        res.json({
            status: 'healthy',
            database: 'connected',
            timestamp: result.rows[0].now
        });
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            database: 'disconnected',
            error: error.message
        });
    }
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🔄 Shutting down gracefully...');
    await pool.end();
    console.log('✅ Database connections closed');
    process.exit(0);
});

const PORT = stagingConfig.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Health check available at http://localhost:${PORT}/health`);
    console.log(`📖 Swagger docs available at http://localhost:${PORT}/api-docs`);
});
