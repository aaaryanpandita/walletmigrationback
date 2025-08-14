const express = require('express');
const router = express.Router();
const pool = require('../connector/db');

// POST /wallet/claim - Handle claim and stake requests
router.post('/claim', async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        const {
            tokenType,
            amount,
            transactionHash,
            fromAddress,
            toAddress,
            timestamp,
            conversionRate
        } = req.body;

        console.log('=== CLAIM REQUEST ===');
        console.log('Request body:', req.body);
        console.log('====================');

        // Validate required fields
        if (!tokenType || !amount || !transactionHash || !fromAddress || !toAddress) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: tokenType, amount, transactionHash, fromAddress, toAddress are required'
            });
        }

        // Validate token type
        if (!['TARAL', 'RVLNG'].includes(tokenType.toUpperCase())) {
            return res.status(400).json({
                success: false,
                error: 'Invalid token type. Must be TARAL or RVLNG'
            });
        }

        // Validate amount is positive number
        const claimAmount = parseFloat(amount);
        if (isNaN(claimAmount) || claimAmount <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid amount. Must be a positive number'
            });
        }

        // Validate conversion rate
        const rate = parseFloat(conversionRate) || 1;
        if (isNaN(rate) || rate <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid conversion rate. Must be a positive number'
            });
        }

        // Check if transaction hash already exists (prevent duplicate claims)
        const existingClaim = await client.query(
            'SELECT id, created_at FROM claims WHERE transaction_hash = $1',
            [transactionHash]
        );

        if (existingClaim.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                error: 'Transaction already processed',
                data: {
                    existingClaimId: existingClaim.rows[0].id,
                    processedAt: existingClaim.rows[0].created_at
                }
            });
        }

        // Normalize addresses
        const userAddress = fromAddress.toLowerCase();
        const destinationAddress = toAddress.toLowerCase();

        // Generate unique claim ID
        const claimId = Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9);
        const novaAmount = claimAmount * rate;
        const claimTimestamp = timestamp || new Date().toISOString();

        // Check if user exists, if not create user record
        const existingUser = await client.query(
            'SELECT address FROM users WHERE address = $1',
            [userAddress]
        );

        if (existingUser.rows.length === 0) {
            console.log('Creating new user:', userAddress);
            await client.query(
                `INSERT INTO users (address, first_claim_at, last_claim_at)
                 VALUES ($1, $2, $2)`,
                [userAddress, claimTimestamp]
            );
        }

        // Insert claim record
        console.log('Inserting claim record...');
        await client.query(
            `INSERT INTO claims (claim_id, user_address, token_type, amount, transaction_hash, 
             from_address, to_address, conversion_rate, nova_amount, timestamp)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [claimId, userAddress, tokenType.toUpperCase(), claimAmount, transactionHash,
             userAddress, destinationAddress, rate, novaAmount, claimTimestamp]
        );

        // Update user totals based on token type
        console.log('Updating user totals...');
        if (tokenType.toUpperCase() === 'TARAL') {
            await client.query(
                `UPDATE users SET 
                 taral_claimed = taral_claimed + $1,
                 total_nova = total_nova + $2,
                 last_claim_at = $3,
                 updated_at = CURRENT_TIMESTAMP
                 WHERE address = $4`,
                [claimAmount, novaAmount, claimTimestamp, userAddress]
            );
        } else if (tokenType.toUpperCase() === 'RVLNG') {
            await client.query(
                `UPDATE users SET 
                 rvlng_claimed = rvlng_claimed + $1,
                 total_nova = total_nova + $2,
                 last_claim_at = $3,
                 updated_at = CURRENT_TIMESTAMP
                 WHERE address = $4`,
                [claimAmount, novaAmount, claimTimestamp, userAddress]
            );
        }

        // Get updated user totals
        const userTotals = await client.query(
            'SELECT taral_claimed, rvlng_claimed, total_nova FROM users WHERE address = $1',
            [userAddress]
        );

        // Get total claims count for user
        const claimsCount = await client.query(
            'SELECT COUNT(*) as total_claims FROM claims WHERE user_address = $1',
            [userAddress]
        );

        await client.query('COMMIT');

        const userStats = userTotals.rows[0];

        // Log successful claim processing
        console.log('=== CLAIM PROCESSED SUCCESSFULLY ===');
        console.log(`User Address: ${userAddress}`);
        console.log(`Token Type: ${tokenType.toUpperCase()}`);
        console.log(`Amount Claimed: ${claimAmount}`);
        console.log(`Transaction Hash: ${transactionHash}`);
        console.log(`Nova Amount: ${novaAmount}`);
        console.log(`Total User TARAL: ${userStats.taral_claimed}`);
        console.log(`Total User RVLNG: ${userStats.rvlng_claimed}`);
        console.log(`Total User Nova: ${userStats.total_nova}`);
        console.log('===================================');

        // Return comprehensive success response
        res.status(200).json({
            success: true,
            data: {
                claimId: claimId,
                userAddress: userAddress,
                tokenType: tokenType.toUpperCase(),
                amountClaimed: claimAmount,
                novaReceived: novaAmount,
                transactionHash,
                status: 'completed',
                timestamp: claimTimestamp,
                userTotals: {
                    taralClaimed: parseFloat(userStats.taral_claimed),
                    rvlngClaimed: parseFloat(userStats.rvlng_claimed),
                    totalNova: parseFloat(userStats.total_nova),
                    totalClaims: parseInt(claimsCount.rows[0].total_claims)
                }
            },
            message: `Successfully processed ${tokenType.toUpperCase()} claim for ${claimAmount} tokens`
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('=== ERROR PROCESSING CLAIM ===');
        console.error('Error details:', error);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        console.error('=============================');
        
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    } finally {
        client.release();
    }
});

// GET /wallet/claims/:address - Get all claims for a user
router.get('/claims/:address', async (req, res) => {
    try {
        const address = req.params.address.toLowerCase();

        // Get user summary
        const userQuery = await pool.query(
            'SELECT * FROM users WHERE address = $1',
            [address]
        );

        if (userQuery.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'No claims found for this address',
                data: {
                    address,
                    totalClaims: 0
                }
            });
        }

        // Get all claims for the user
        const claimsQuery = await pool.query(
            `SELECT claim_id, token_type, amount, transaction_hash, from_address, to_address,
             conversion_rate, nova_amount, status, timestamp, created_at
             FROM claims WHERE user_address = $1 
             ORDER BY timestamp DESC`,
            [address]
        );

        const userWallet = userQuery.rows[0];

        res.status(200).json({
            success: true,
            data: {
                address,
                summary: {
                    taralClaimed: parseFloat(userWallet.taral_claimed),
                    rvlngClaimed: parseFloat(userWallet.rvlng_claimed),
                    totalNova: parseFloat(userWallet.total_nova),
                    totalClaims: claimsQuery.rows.length,
                    firstClaimAt: userWallet.first_claim_at,
                    lastClaimAt: userWallet.last_claim_at
                },
                claims: claimsQuery.rows.map(claim => ({
                    ...claim,
                    amount: parseFloat(claim.amount),
                    conversion_rate: parseFloat(claim.conversion_rate),
                    nova_amount: parseFloat(claim.nova_amount)
                }))
            }
        });

    } catch (error) {
        console.error('Error fetching claims:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// GET /wallet/stats - Get overall statistics
router.get('/stats', async (req, res) => {
    try {
        // Get total users
        const usersCount = await pool.query('SELECT COUNT(*) as total_users FROM users');
        
        // Get total claims
        const claimsCount = await pool.query('SELECT COUNT(*) as total_claims FROM claims');
        
        // Get total amounts by token type
        const taralTotal = await pool.query(
            "SELECT COALESCE(SUM(amount), 0) as total FROM claims WHERE token_type = 'TARAL'"
        );
        
        const rvlngTotal = await pool.query(
            "SELECT COALESCE(SUM(amount), 0) as total FROM claims WHERE token_type = 'RVLNG'"
        );
        
        // Get total nova distributed
        const novaTotal = await pool.query(
            'SELECT COALESCE(SUM(nova_amount), 0) as total FROM claims'
        );
        
        // Get recent claims (last 10)
        const recentClaims = await pool.query(
            `SELECT claim_id, user_address, token_type, amount, nova_amount, timestamp
             FROM claims ORDER BY created_at DESC LIMIT 10`
        );

        res.status(200).json({
            success: true,
            data: {
                totalUsers: parseInt(usersCount.rows[0].total_users),
                totalClaims: parseInt(claimsCount.rows[0].total_claims),
                totalTaralClaimed: parseFloat(taralTotal.rows[0].total),
                totalRvlngClaimed: parseFloat(rvlngTotal.rows[0].total),
                totalNovaDistributed: parseFloat(novaTotal.rows[0].total),
                recentClaims: recentClaims.rows.map(claim => ({
                    ...claim,
                    amount: parseFloat(claim.amount),
                    nova_amount: parseFloat(claim.nova_amount),
                    user_address: claim.user_address.slice(0, 10) + '...' // Truncate for privacy
                }))
            }
        });

    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// GET /wallet/verify/:hash - Verify a transaction
router.get('/verify/:hash', async (req, res) => {
    try {
        const hash = req.params.hash;
        
        const claimQuery = await pool.query(
            `SELECT c.*, u.address as user_address_full
             FROM claims c
             JOIN users u ON c.user_address = u.address
             WHERE c.transaction_hash = $1`,
            [hash]
        );

        if (claimQuery.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Transaction not found'
            });
        }

        const claim = claimQuery.rows[0];

        res.status(200).json({
            success: true,
            data: {
                verified: true,
                claim: {
                    ...claim,
                    amount: parseFloat(claim.amount),
                    conversion_rate: parseFloat(claim.conversion_rate),
                    nova_amount: parseFloat(claim.nova_amount)
                }
            }
        });

    } catch (error) {
        console.error('Error verifying transaction:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Test endpoint to verify database connection and table structure
router.get('/test', async (req, res) => {
    try {
        // Test database connection
        const connectionTest = await pool.query('SELECT NOW()');
        
        // Check if tables exist
        const tablesCheck = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('users', 'claims')
        `);
        
        // Get table structure
        const usersColumns = await pool.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'users'
            ORDER BY ordinal_position
        `);
        
        const claimsColumns = await pool.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'claims'
            ORDER BY ordinal_position
        `);

        res.status(200).json({
            success: true,
            data: {
                connection: 'OK',
                timestamp: connectionTest.rows[0].now,
                tables: tablesCheck.rows,
                schema: {
                    users: usersColumns.rows,
                    claims: claimsColumns.rows
                }
            }
        });

    } catch (error) {
        console.error('Database test error:', error);
        res.status(500).json({
            success: false,
            error: 'Database test failed',
            message: error.message
        });
    }
});

module.exports = router;