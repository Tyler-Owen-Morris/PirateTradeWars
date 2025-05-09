import React, { useState } from 'react';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { SHIP_PRICES } from '@shared/gameConstants';
// import dotenv from 'dotenv';
// dotenv.config();

// Initialize Stripe with your publishable key
// console.log("VITE_STRIPE_PUBLISHABLE_KEY:", import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

interface PaymentModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    onError: (error: { message: string; type?: string; code?: string }) => void;
    clientSecret: string; // From backend Payment Intent
    shipName: string;
    amount: number; // Price in the smallest currency unit (e.g., cents)
}

const PaymentModal: React.FC<PaymentModalProps> = ({ isOpen, onClose, onSuccess, onError, clientSecret, shipName }) => {
    if (!isOpen) return null;
    // const SHIP_PRICES: { [key: string]: number } = {
    //     brigantine: 100, // $1.00
    //     galleon: 200,    // $2.00
    //     'man-o-war': 400 // $4.00
    // };
    const price = SHIP_PRICES[shipName];


    // Debug log to check the incoming price value
    console.log('Raw price value:', price, 'Type:', typeof price);

    // Ensure price is a valid number and convert to dollars
    const priceInDollars = Number(price) / 100;
    console.log('Price in dollars:', priceInDollars);

    // Format price to display in dollars
    const formattedPrice = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(priceInDollars);

    console.log('Formatted price:', formattedPrice);

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            overflow: 'auto',
            padding: '20px'
        }}>
            <div style={{
                background: 'white',
                padding: '24px',
                borderRadius: '12px',
                width: '400px',
                maxWidth: '100%',
                boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
                margin: 'auto'
            }}>
                <div style={{
                    borderBottom: '1px solid #e5e7eb',
                    paddingBottom: '16px',
                    marginBottom: '20px'
                }}>
                    <h2 style={{
                        fontSize: '24px',
                        fontWeight: '600',
                        color: '#1f2937',
                        marginBottom: '8px'
                    }}>
                        Complete Your Purchase
                    </h2>
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        backgroundColor: '#f9fafb',
                        padding: '12px',
                        borderRadius: '8px'
                    }}>
                        <div>
                            <div style={{
                                fontSize: '16px',
                                fontWeight: '500',
                                color: '#374151'
                            }}>
                                {shipName}
                            </div>
                            <div style={{
                                fontSize: '14px',
                                color: '#6b7280'
                            }}>
                                Ship Purchase
                            </div>
                        </div>
                        <div style={{
                            fontSize: '20px',
                            fontWeight: '600',
                            color: '#059669'
                        }}>
                            {formattedPrice}
                        </div>
                    </div>
                </div>
                <Elements stripe={stripePromise} options={{ clientSecret }}>
                    <CheckoutForm onSuccess={onSuccess} onClose={onClose} onError={onError} />
                </Elements>
            </div>
        </div>
    );
};

const CheckoutForm: React.FC<{ onSuccess: () => void; onClose: () => void; onError: (error: { message: string; type?: string; code?: string }) => void }> = ({ onSuccess, onClose, onError }) => {
    const stripe = useStripe();
    const elements = useElements();
    const [error, setError] = useState<string | null>(null);
    const [processing, setProcessing] = useState(false);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!stripe || !elements) return;

        setProcessing(true);
        const { error, paymentIntent } = await stripe.confirmPayment({
            elements,
            confirmParams: {
                return_url: window.location.href,
            },
            redirect: 'if_required',
        });

        setProcessing(false);

        if (error) {
            const errorDetails = {
                message: error.message || 'Payment failed',
                type: error.type,
                code: error.code,
            };
            setError(errorDetails.message);
            onError(errorDetails);
        } else if (paymentIntent?.status === 'succeeded') {
            onSuccess();
            onClose();
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <PaymentElement />
            {error && <div style={{ color: 'red' }}>{error}</div>}
            <button type="submit" disabled={!stripe || processing} style={{ marginTop: '10px', padding: '10px 20px' }}>
                {processing ? 'Processing...' : 'Pay Now'}
            </button>
            <button type="button" onClick={onClose} style={{ marginLeft: '10px', padding: '10px 20px' }}>
                Cancel
            </button>
        </form>
    );
};

export default PaymentModal;