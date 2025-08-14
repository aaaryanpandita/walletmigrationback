const express = require('express');
const app = express();
const cors = require('cors');
const walletRoutes = require('./user/wallet');




// CORS configuration - Allow all origins
app.use(cors({
    origin: '*',
    credentials: false, // Set to false when using wildcard origin
    optionsSuccessStatus: 200
}));

app.use(express.json());

// Mount wallet routes
app.use('/wallet', walletRoutes);

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ 
        message: 'Server is running!',
        timestamp: new Date().toISOString(),
        database: 'Connected'
    });
});

// Database health check endpoint
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Health check available at http://localhost:${PORT}/health`);
});