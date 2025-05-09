import type { Express, Request, Response } from "express";
import express from "express";
import Stripe from "stripe";
import { redisStorage } from '../redisStorage';
import { SHIP_PRICES } from '@shared/gameConstants';
import { v4 as uuidv4 } from 'uuid';

// Initialize Stripe with your secret key (loaded from environment variable)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2025-04-30.basil',
});

// Map of ship names to their corresponding Price IDs
const SHIP_PRICE_IDS: { [key: string]: string } = {
    brigantine: process.env.STRIPE_BRIGANTINE_PRICE_ID!,
    galleon: process.env.STRIPE_GALLEON_PRICE_ID!,
    'man-o-war': process.env.STRIPE_MANOWAR_PRICE_ID!
};

// Webhook secret for verifying Stripe webhook signatures
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;

export function registerStripeRoutes(app: Express) {
    // Middleware for JSON parsing (specific to Stripe routes)
    app.use('/api/stripe', express.json());

    // Middleware for raw body parsing (specific to webhook)
    app.use(
        '/api/stripe/webhook',
        express.raw({ type: 'application/json' })
    );

    // Route to create a Payment Intent for a premium ship
    app.post('/api/stripe/create-payment-intent', async (req: Request, res: Response) => {
        const { shipName, amount, currency, playerName, tempPlayerId } = req.body;
        console.log("create-payment-intent request:", req.body)
        if (!shipName || !amount || !currency || !playerName || !tempPlayerId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        const normalizedShipName = shipName.toLowerCase();
        const priceId = SHIP_PRICE_IDS[normalizedShipName];
        if (!priceId) {
            return res.status(400).json({ error: 'Invalid ship name' });
        }

        // Validate amount and currency
        try {
            const price = await stripe.prices.retrieve(priceId);
            if (!price.unit_amount || price.currency !== currency || price.unit_amount !== amount) {
                return res.status(400).json({ error: 'Invalid amount or currency for this ship' });
            }
        } catch (error) {
            console.error('Error retrieving price:', error);
            return res.status(500).json({ error: 'Failed to validate price' });
        }
        // Verify the name reservation
        const reservedPlayerId = await redisStorage.getActiveNamePlayerId(playerName);
        if (reservedPlayerId !== tempPlayerId) {
            return res.status(400).json({ error: 'Name reservation invalid or expired' });
        }
        try {
            const paymentIntent = await stripe.paymentIntents.create({
                amount,
                currency,
                payment_method_types: ['card'],
                metadata: {
                    shipName,
                    playerName,
                    tempPlayerId,
                    priceId
                },
            });
            res.json({ clientSecret: paymentIntent.client_secret });
        } catch (error) {
            console.error('Error creating Payment Intent:', error);
            res.status(500).json({ error: 'Failed to create payment intent' });
        }
    });

    // Webhook route to handle Stripe events (e.g., payment confirmation)
    app.post('/api/stripe/webhook', async (req: Request, res: Response) => {
        const sig = req.headers['stripe-signature'] as string;

        try {
            // Verify webhook signature
            const event = stripe.webhooks.constructEvent(
                req.body,
                sig,
                WEBHOOK_SECRET
            );
            console.log("stripe webhook event:", event)

            // Handle specific events
            if (event.type === 'payment_intent.succeeded') {
                const paymentIntent = event.data.object as Stripe.PaymentIntent;
                const { shipName, playerName } = paymentIntent.metadata;

                if (shipName && playerName) {
                    // Store purchase in redis
                    const purchaseKey = `purchase:${playerName}:${shipName.toLowerCase()}`;
                    //await redisStorage.set(purchaseKey, 'true');
                    console.log(`Purchase recorded for ${playerName}: ${shipName}`);
                }
            }

            // Acknowledge receipt of webhook
            res.json({ received: true });
        } catch (error: any) {
            console.error('Webhook error:', error.message);
            res.status(400).json({ error: 'Webhook error' });
        }
    });

    // Check if a name is available and reserve it if it is
    app.get('/api/check-name', async (req: Request, res: Response) => {
        const { name } = req.query;
        if (!name || typeof name !== 'string') {
            return res.status(400).json({ error: 'Invalid name' });
        }
        try {
            const isActive = await redisStorage.isNameActive(name);
            if (isActive) {
                return res.status(400).json({ error: 'Name already in use' });
            }
            const tempPlayerId = uuidv4();
            await redisStorage.reserveName(name, tempPlayerId);
            res.json({ available: true, tempPlayerId });
        } catch (error) {
            console.error('Error checking name availability:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // Release a name reservation
    app.post('/api/release-name', async (req: Request, res: Response) => {
        const { name, tempPlayerId } = req.body;
        if (!name || !tempPlayerId) {
            return res.status(400).json({ error: 'Missing name or tempPlayerId' });
        }
        try {
            const reservedPlayerId = await redisStorage.redis.get(`active_name:${name}`);
            if (reservedPlayerId === tempPlayerId) {
                await redisStorage.removeActiveName(name);
                res.json({ success: true });
            } else {
                res.status(400).json({ error: 'Invalid tempPlayerId for this name' });
            }
        } catch (error) {
            console.error('Error releasing name:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });
}