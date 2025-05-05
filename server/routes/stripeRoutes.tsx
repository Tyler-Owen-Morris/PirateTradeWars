import type { Express, Request, Response } from "express";
import express from "express";
import Stripe from "stripe";
import { redisStorage } from '../redisStorage';
import { SHIP_PRICES } from '@shared/gameConstants';

// Initialize Stripe with your secret key (loaded from environment variable)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2025-04-30.basil',
});

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
        const { shipName, amount, currency, playerName } = req.body;
        console.log("create-payment-intent request:", req.body)
        // Validate request
        if (!shipName || !amount || !currency) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const normalizedShipName = shipName.toLowerCase();
        if (!SHIP_PRICES[normalizedShipName]) {
            return res.status(400).json({ error: 'Invalid ship name' });
        }

        if (amount !== SHIP_PRICES[normalizedShipName]) {
            return res.status(400).json({ error: 'Invalid amount for this ship' });
        }

        if (currency !== 'usd') {
            return res.status(400).json({ error: 'Unsupported currency' });
        }

        try {
            // Check if player already owns the ship
            // const purchaseKey = `purchase:${playerName}:${normalizedShipName}`;
            // const hasPurchased = await redisStorage.get(purchaseKey);
            // if (hasPurchased) {
            //     return res.status(400).json({ error: 'You already own this ship' });
            // }

            // Create Payment Intent
            const paymentIntent = await stripe.paymentIntents.create({
                amount, // Amount in cents
                currency,
                payment_method_types: ['card'],
                metadata: {
                    shipName,
                    playerName,
                },
            });

            // Return client secret to frontend
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
}