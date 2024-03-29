import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as events from "aws-cdk-lib/aws-lambda-event-sources";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Duration, RemovalPolicy } from "aws-cdk-lib";



import { Construct } from "constructs";
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class EDAAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
  

    const imagesBucket = new s3.Bucket(this, "images", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
    });

    const badOrdersQueue = new sqs.Queue(this, "bad-orders-q", {
      retentionPeriod: Duration.seconds(60),
    });

    const imageProcessQueue = new sqs.Queue(this, "img-created-queue", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
      deadLetterQueue: {
        queue: badOrdersQueue,
        // # of rejections by consumer (lambda function)
        maxReceiveCount: 1,
      },
    });

    


    const newImageTopic = new sns.Topic(this, "NewImageTopic", {
      displayName: "New Image topic",
    }); 

    const secondTopic = new sns.Topic(this, "secondTopic", {
      displayName: "Second Topic"
    })

    const imagesTable = new dynamodb.Table(this, "imagesTable", {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: "ImageName", type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,                                 
      tableName: "Images",                                                     
    })

    // Lambda functions

    const failedMailerFn = new lambdanode.NodejsFunction(this, "failed-mailer-function", {
      runtime: lambda.Runtime.NODEJS_16_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(3),
      entry: `${__dirname}/../lambdas/rejectionMailer.ts`,
      
    });

    const processImageFn = new lambdanode.NodejsFunction(
      this,
      "ProcessImageFn",
      {
        // architecture: lambda.Architecture.ARM_64,
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: `${__dirname}/../lambdas/processImage.ts`,
        timeout: cdk.Duration.seconds(15),
        memorySize: 128,
        environment: {
          TABLE_NAME: imagesTable.tableName,
          REGION: 'eu-west-1',
        },
      }
    );

    const deleteImageFn = new lambdanode.NodejsFunction(
      this,
      "delete-image",
      {
        // architecture: lambda.Architecture.ARM_64,
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: `${__dirname}/../lambdas/deleteImage.ts`,
        timeout: cdk.Duration.seconds(15),
        memorySize: 128,
        environment: {
          TABLE_NAME: imagesTable.tableName,
          REGION: 'eu-west-1',
        },
      }
    );
    const mailerFn = new lambdanode.NodejsFunction(this, "mailer-function", {
      runtime: lambda.Runtime.NODEJS_16_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(3),
      entry: `${__dirname}/../lambdas/mailer.ts`,
      
    });



    // Event triggers

    imagesBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SnsDestination(newImageTopic)  // Changed
  );

  imagesBucket.addEventNotification(
    s3.EventType.OBJECT_REMOVED,
    new s3n.SnsDestination(secondTopic) //notification for second topic
  )



  newImageTopic.addSubscription(
    new subs.SqsSubscription(imageProcessQueue)
  );

  secondTopic.addSubscription(
    new subs.LambdaSubscription(deleteImageFn)
    );




    const newImageEventSource = new events.SqsEventSource(imageProcessQueue, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(10),
    });

    const failedImageEventSource = new events.SqsEventSource(badOrdersQueue, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(10),
    })

 
    processImageFn.addEventSource(newImageEventSource);
  
    newImageTopic.addSubscription(new subs.LambdaSubscription(mailerFn)) 
    
    failedMailerFn.addEventSource(failedImageEventSource)

    imagesTable.grantReadWriteData(deleteImageFn)


    // Permissions

    imagesBucket.grantRead(processImageFn);
    imagesTable.grantReadWriteData(processImageFn)

    mailerFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ses:SendEmail",
          "ses:SendRawEmail",
          "ses:SendTemplatedEmail",
        ],
        resources: ["*"],
      })
    );

    failedMailerFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ses:SendEmail",
          "ses:SendRawEmail",
          "ses:SendTemplatedEmail",
        ],
        resources: ["*"],
      })
    );

    // Output
    
    new cdk.CfnOutput(this, "bucketName", {
      value: imagesBucket.bucketName,
    });


    
  }




}
