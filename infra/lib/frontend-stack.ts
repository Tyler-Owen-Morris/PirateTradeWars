import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';

export class PirateTradeWarsFrontendStack extends cdk.Stack {
    constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const bucket = new s3.Bucket(this, 'PirateTradeWarsFrontendBucket', {
            bucketName: 'piratetradewars-frontend-bucket',
            websiteIndexDocument: 'index.html',
            publicReadAccess: true,
            blockPublicAccess: new s3.BlockPublicAccess({
                blockPublicAcls: false,
                ignorePublicAcls: false,
                blockPublicPolicy: false,
                restrictPublicBuckets: false,
            }),
        });

        new s3deploy.BucketDeployment(this, 'PirateTradeWarsDeployFrontend', {
            sources: [s3deploy.Source.asset('../dist')], // Adjust path to your React build directory
            destinationBucket: bucket,
        });

        new cdk.CfnOutput(this, 'PirateTradeWarsBucketUrl', {
            value: bucket.bucketWebsiteUrl,
        });
    }
}