import React, { useState } from 'react';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import type { Appearance } from '@stripe/stripe-js';
import { ParchmentPanel, PirateButton } from './pirate';

// Stripe's Payment Element runs in an iframe; these variables tint it to sit on the parchment panel.
const STRIPE_APPEARANCE: Appearance = {
    theme: 'stripe',
    variables: {
        colorPrimary: '#7a571e',
        colorBackground: '#fbf3df',
        colorText: '#2a1a0c',
        colorDanger: '#8e1a14',
        fontFamily: 'Georgia, "Times New Roman", serif',
        borderRadius: '4px',
    },
};
import { SHIP_PRICES } from '@shared/gameConstants';
// import dotenv from 'dotenv';
// dotenv.config();

// Initialize Stripe with your publishable key
console.log("VITE_STRIPE_PUBLISHABLE_KEY:", import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || 'pk_live_51RMYdZEa5C1LC1J5o9To6cGUEqAwViLuUTxGvrqMCFo1RITtuPWGitMpW4KfCdZii37FU7kEjnjyQRUvKM9MeEbj00A3SeWAha');

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
    // Add cleanup effect
    // React.useEffect(() => {
    //     return () => {
    //         // Cleanup function when component unmounts
    //         if (stripePromise) {
    //             // Force a new instance to be created next time
    //             stripePromise.then(stripe => {
    //                 if (stripe) {
    //                     stripe._elements = null;
    //                 }
    //             });
    //         }
    //     };
    // }, []);

    if (!isOpen) return null;
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
    console.log("clientSecret:", clientSecret)

    return (
        <div className="fixed inset-0 flex items-center justify-center overflow-auto p-4 sm:p-5 bg-black/60">
            <ParchmentPanel
                torn
                role="dialog"
                aria-modal="true"
                aria-labelledby="ptw-payment-title"
                className="w-[400px] max-w-full m-auto px-6 pt-7 pb-6"
            >
                <div className="pb-4 mb-5 border-b border-ptw-ink/25">
                    <h2 id="ptw-payment-title" className="ptw-title text-3xl mb-3">
                        Complete Your Purchase
                    </h2>
                    <div className="flex justify-between items-center rounded-sm px-3 py-2.5 border border-ptw-ink/25 bg-ptw-parchment-hi/60">
                        <div>
                            <div className="ptw-font-display text-xl leading-tight">
                                {shipName}
                            </div>
                            <div className="ptw-font-label text-sm text-ptw-ink-soft">
                                Ship Purchase
                            </div>
                        </div>
                        <div className="ptw-num text-2xl font-bold text-ptw-good-ink">
                            {formattedPrice}
                        </div>
                    </div>
                </div>
                <Elements stripe={stripePromise} options={{ clientSecret, appearance: STRIPE_APPEARANCE }}>
                    <CheckoutForm onSuccess={onSuccess} onClose={onClose} onError={onError} />
                </Elements>
            </ParchmentPanel>
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
        console.log("stripe:", stripe)
        console.log("elements:", elements)

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
            {error && <div role="alert" className="ptw-alert mt-3">{error}</div>}
            <div className="flex flex-col-reverse sm:flex-row gap-2 mt-4">
                <PirateButton variant="rope" onClick={onClose} className="sm:flex-1">
                    Cancel
                </PirateButton>
                <PirateButton type="submit" disabled={!stripe || processing} className="sm:flex-1">
                    {processing ? 'Processing...' : 'Pay Now'}
                </PirateButton>
            </div>
        </form>
    );
};

export default PaymentModal;
