import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as fs from 'fs';
import * as path from 'path';

export class PirateTradeWarsFrontendStack extends cdk.Stack {
    constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // Import existing bucket
        const bucket = s3.Bucket.fromBucketName(this, 'PirateTradeWarsFrontendBucket', 'piratetradewars-frontend-bucket');

        // Debug: Print directory contents
        console.log('Current directory (infra/lib):', fs.readdirSync(__dirname));
        console.log('One level up (infra):', fs.readdirSync(path.join(__dirname, '..')));
        console.log('Two levels up (repository root):', fs.readdirSync(path.join(__dirname, '../..')));
        console.log('Checking existence of dist/public:', fs.existsSync(path.join(__dirname, '../../dist/public')));

        new s3deploy.BucketDeployment(this, 'PirateTradeWarsDeployFrontend', {
            sources: [s3deploy.Source.asset('../../dist/public')],
            destinationBucket: bucket,
        });

        new cdk.CfnOutput(this, 'PirateTradeWarsBucketUrl', {
            value: bucket.bucketWebsiteUrl,
        });
    }
}