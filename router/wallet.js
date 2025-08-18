//newww

import express from 'express';
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { connect, query } from '../connector/db.js';

const router = express.Router();

/**
 * @swagger
 * /wallet/claim:
 *   post:
 *     summary: Claim & stake tokens
 *     description: Handles claim and staking after ETH transfer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tokenType:
 *                 type: string
 *                 example: TARAL
 *               amount:
 *                 type: string
 *                 example: "0.0001"
 *               transactionHash:
 *                 type: string
 *                 example: "0x123abc..."
 *               conversionRate:
 *                 type: string
 *                 example: "2.5"
 *     responses:
 *       200:
 *         description: Successfully claimed
 *       400:
 *         description: Bad request
 */

// Function to load wallet allocations from CSV
const loadWalletAllocations = () => {
    try {
        const csvPath = path.join(process.cwd(), 'data', 'wallet_allocations.csv');
        const csvContent = fs.readFileSync(csvPath, 'utf-8');
        const records = parse(csvContent, {
            columns: true,
            skip_empty_lines: true,
            trim: true
        });
        
        const allocations = {};
        records.forEach(record => {
            const address = record.wallet_address.toLowerCase();
            allocations[address] = {
                taral: parseFloat(record.taral_amount),
                rvlng: parseFloat(record.rvlng_amount)
            };
        });
        
       // console.log('Loaded wallet allocations:', allocations);
        return allocations;
    } catch (error) {
        console.error('Error loading wallet allocations:', error);
        
        
    }
};

// Load allocations on startup
let WALLET_ALLOCATIONS = loadWalletAllocations();

// Function to get user's allocation for a specific token
const getUserAllocation = (userAddress, tokenType) => {
    const normalizedAddress = userAddress.toLowerCase();
    const allocation = WALLET_ALLOCATIONS[normalizedAddress];
    
    if (!allocation) {
        return null;
    }
    
    return tokenType.toUpperCase() === 'TARAL' ? allocation.taral : allocation.rvlng;
};

// POST /wallet/claim - Handle claim and stake requests
router.post('/claim', async (req, res) => {
    const client = await connect();
    
    try {
        await client.query('BEGIN');

        const {
            tokenType,
            amount,
            transactionHash,
            userAddress,
            timestamp,
            conversionRate
        } = req.body;


        // Validate required fields
        if (!tokenType || !amount || !transactionHash || !userAddress) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: tokenType, amount, transactionHash, userAddress are required'
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

        // Use the actual user's wallet address from frontend
        const claimUserAddress = userAddress.toLowerCase();

        // Check if user has allocation for this token type
        const userAllocation = getUserAllocation(claimUserAddress, tokenType);
        if (userAllocation === null) {
            return res.status(403).json({
                success: false,
                error: 'Wallet address not found in allocation list'
            });
        }

        // Verify the claim amount matches the user's allocation
        if (Math.abs(claimAmount - userAllocation) > 0.01) { // Allow small floating point differences
            return res.status(400).json({
                success: false,
                error: `Invalid claim amount. Expected ${userAllocation} ${tokenType.toUpperCase()} for this wallet`,
                data: {
                    expectedAmount: userAllocation,
                    providedAmount: claimAmount
                }
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

        // Check if user has already claimed this token type
        const existingTokenClaim = await client.query(
            'SELECT id, created_at FROM claims WHERE user_address = $1 AND token_type = $2',
            [claimUserAddress, tokenType.toUpperCase()]
        );

        if (existingTokenClaim.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                error: `${tokenType.toUpperCase()} already claimed by this wallet`,
                data: {
                    existingClaimId: existingTokenClaim.rows[0].id,
                    claimedAt: existingTokenClaim.rows[0].created_at
                }
            });
        }

        // Generate unique claim ID
        const claimId = Date.now().toString() + '_' + Math.random().toString(36).slice(2, 9);
        const novaAmount = claimAmount * rate;
        const claimTimestamp = timestamp || new Date().toISOString();

        // Check if user exists, if not create user record
        const existingUser = await client.query(
            'SELECT address FROM users WHERE address = $1',
            [claimUserAddress]
        );

        if (existingUser.rows.length === 0) {
            await client.query(
                `INSERT INTO users (address, first_claim_at, last_claim_at)
                 VALUES ($1, $2, $2)`,
                [claimUserAddress, claimTimestamp]
            );
        }

        // Insert claim record with actual user address

        await client.query(
            `INSERT INTO claims (claim_id, user_address, token_type, amount, transaction_hash, 
             conversion_rate, nova_amount, timestamp)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [claimId, claimUserAddress, tokenType.toUpperCase(), claimAmount, transactionHash, rate, novaAmount, claimTimestamp]
        );

        // Update user totals based on token type
       
        if (tokenType.toUpperCase() === 'TARAL') {
            await client.query(
                `UPDATE users SET 
                 taral_claimed = taral_claimed + $1,
                 total_nova = total_nova + $2,
                 last_claim_at = $3,
                 updated_at = CURRENT_TIMESTAMP
                 WHERE address = $4`,
                [claimAmount, novaAmount, claimTimestamp, claimUserAddress]
            );
        } else if (tokenType.toUpperCase() === 'RVLNG') {
            await client.query(
                `UPDATE users SET 
                 rvlng_claimed = rvlng_claimed + $1,
                 total_nova = total_nova + $2,
                 last_claim_at = $3,
                 updated_at = CURRENT_TIMESTAMP
                 WHERE address = $4`,
                [claimAmount, novaAmount, claimTimestamp, claimUserAddress]
            );
        }

        // Get updated user totals
        const userTotals = await client.query(
            'SELECT taral_claimed, rvlng_claimed, total_nova FROM users WHERE address = $1',
            [claimUserAddress]
        );

        // Get total claims count for user
        const claimsCount = await client.query(
            'SELECT COUNT(*) as total_claims FROM claims WHERE user_address = $1',
            [claimUserAddress]
        );

        await client.query('COMMIT');

        const userStats = userTotals.rows[0];

        // Return comprehensive success response
        res.status(200).json({
            success: true,
            data: {
                claimId: claimId,
                tokenType: tokenType.toUpperCase(),
                amountClaimed: claimAmount,
                novaReceived: novaAmount,
                transactionHash,
                userAddress: claimUserAddress,
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

// GET /wallet/allocations/:address - Get allocation info for a specific address
router.get('/allocations/:address', async (req, res) => {
  try {
    const address = req.params.address.toLowerCase();
    const allocation = WALLET_ALLOCATIONS[address];

    if (!allocation) {
      return res.status(404).json({
        success: false,
        error: 'Wallet address not found in allocation list',
        data: { address: req.params.address }
      });
    }

    // Get already claimed amounts
    const claimedTokens = await query(
      'SELECT token_type, amount FROM claims WHERE user_address = $1',
      [address]
    );

    const claimed = { taral: 0, rvlng: 0 };

    claimedTokens.rows.forEach(claim => {
      if (claim.token_type === 'TARAL') {
        claimed.taral += parseFloat(claim.amount);
      } else if (claim.token_type === 'RVLNG') {
        claimed.rvlng += parseFloat(claim.amount);
      }
    });

    // Safe remaining values
    const taralRemaining = Math.max(0, allocation.taral - claimed.taral);
    const rvlngRemaining = Math.max(0, allocation.rvlng - claimed.rvlng);

    res.status(200).json({
      success: true,
      data: {
        address: req.params.address,
        allocations: {
          taral: {
            allocated: allocation.taral,
            claimed: claimed.taral,
            remaining: taralRemaining,
            canClaim: taralRemaining > 0
          },
          rvlng: {
            allocated: allocation.rvlng,
            claimed: claimed.rvlng,
            remaining: rvlngRemaining,
            canClaim: rvlngRemaining > 0
          }
        }
      }
    });
  } catch (error) {
    console.error('Error fetching allocations:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});


// GET
router.get('/claims/:address', async (req, res) => {
    try {
        const address = req.params.address.toLowerCase();

        // Get all claims for the user
        const claimsQuery = await query(
            `SELECT claim_id, token_type, amount, transaction_hash,
             conversion_rate, nova_amount, status, timestamp, created_at
             FROM claims WHERE user_address = $1 
             ORDER BY timestamp DESC`,
            [address]
        );

        if (claimsQuery.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'No claims found for this address',
                data: {
                    address,
                    totalClaims: 0
                }
            });
        }

        // Calculate actual totals from claims data (instead of relying on stored totals)
        const claims = claimsQuery.rows;
        let taralClaimed = 0;
        let rvlngClaimed = 0;
        let totalNova = 0;
        let firstClaimAt = null;
        let lastClaimAt = null;

        claims.forEach(claim => {
            const amount = parseFloat(claim.amount);
            const novaAmount = parseFloat(claim.nova_amount);
            
            if (claim.token_type === 'TARAL') {
                taralClaimed += amount;
            } else if (claim.token_type === 'RVLNG') {
                rvlngClaimed += amount;
            }
            
            totalNova += novaAmount;
            
            // Track first and last claim timestamps
            const claimTime = new Date(claim.timestamp);
            if (!firstClaimAt || claimTime < new Date(firstClaimAt)) {
                firstClaimAt = claim.timestamp;
            }
            if (!lastClaimAt || claimTime > new Date(lastClaimAt)) {
                lastClaimAt = claim.timestamp;
            }
        });

        res.status(200).json({
            success: true,
            data: {
                address,
                summary: {
                    taralClaimed: taralClaimed,
                    rvlngClaimed: rvlngClaimed,
                    totalNova: totalNova,
                    totalClaims: claims.length,
                    firstClaimAt: firstClaimAt,
                    lastClaimAt: lastClaimAt
                },
                claims: claims.map(claim => ({
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



export default router;