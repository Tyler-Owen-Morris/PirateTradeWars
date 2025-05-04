#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { PirateTradeWarsFrontendStack } from '../lib/frontend-stack';
import { PirateTradeWarsGameServerStack } from '../lib/game-server-stack';

const app = new cdk.App();
new PirateTradeWarsFrontendStack(app, 'PirateTradeWarsFrontendStack', { env: { region: 'us-east-2' } });
new PirateTradeWarsGameServerStack(app, 'PirateTradeWarsGameServerStack', { env: { region: 'us-east-2' } });