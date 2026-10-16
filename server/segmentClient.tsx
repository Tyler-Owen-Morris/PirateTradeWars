import { Analytics } from '@segment/analytics-node';

const segment = new Analytics({
    writeKey: process.env.SEGMENT_WRITE_KEY!,
    flushInterval: 1000, // Flush events every 1 second
});

export function identifyPlayer(playerId: string, traits: { name?: string; shipType?: string; gold?: number; createdAt?: Date }) {
    segment.identify({
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
    segment.track({
        userId,
        event,
        properties,
        timestamp: new Date(),
    });
}

export function flushSegment() {
    return segment.flush();
}