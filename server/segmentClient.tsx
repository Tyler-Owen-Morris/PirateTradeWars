import { Analytics } from '@segment/analytics-node';

// Segment analytics. The client batches and flushes on its own (every second), so callers never
// need to await anything on hot paths. Without SEGMENT_WRITE_KEY (local dev, tests, bots) every
// function is a no-op instead of throwing at import time.
const segment = process.env.SEGMENT_WRITE_KEY
    ? new Analytics({
        writeKey: process.env.SEGMENT_WRITE_KEY,
        flushInterval: 1000, // Flush events every 1 second
    })
    : null;

if (!segment) console.log('SEGMENT_WRITE_KEY not set: analytics disabled');

export function identifyPlayer(playerId: string, traits: { name?: string; shipType?: string; gold?: number; createdAt?: Date }) {
    segment?.identify({
        userId: playerId,
        traits: {
            name: traits.name,
            shipType: traits.shipType,
            gold: traits.gold,
            createdAt: traits.createdAt || new Date(),
        },
    });
}

export function trackEvent(userId: string, event: string, properties: Record<string, any>) {
    segment?.track({
        userId,
        event,
        properties,
        timestamp: new Date(),
    });
}

/** Flush queued events now. Not needed on hot paths: the client batches and flushes every second. */
export function flushSegment(): Promise<void> {
    return segment ? segment.flush() : Promise.resolve();
}

/** Stop accepting events and flush everything queued (graceful process shutdown). */
export function shutdownSegment(timeoutMs = 5000): Promise<void> {
    return segment ? segment.closeAndFlush({ timeout: timeoutMs }) : Promise.resolve();
}
