# Tutorial 5: Cloudflare R2 Storage Integration

Storing images in a database is an anti-pattern. Instead, we use Cloudflare R2, an S3-compatible object storage service with zero egress fees, served automatically via Cloudflare's CDN.

## Step 1: Set Up Cloudflare R2

1. Log into your Cloudflare dashboard.
2. Navigate to **R2**.
3. Create a new bucket (e.g., `portfolio-assets`).
4. In the bucket settings, you can attach a Custom Domain (e.g., `cdn.yourdomain.com`). This is how your Astro site will load the images.

## Step 2: Generate API Tokens

In Cloudflare, generate an API token for R2. You will need:
- Access Key ID
- Secret Access Key
- Endpoint URL (looks like `https://<account_id>.r2.cloudflarestorage.com`)

## Step 3: Configure Go to Use S3/R2

Since R2 is S3-compatible, we can use the official AWS SDK for Go.

```bash
cd api
go get github.com/aws/aws-sdk-go-v2
go get github.com/aws/aws-sdk-go-v2/config
go get github.com/aws/aws-sdk-go-v2/service/s3
```

## Step 4: Generating Presigned URLs for Uploads

To avoid uploading images *through* your Go server (which wastes bandwidth and incurs GCP egress), your Go API should generate a "Presigned URL". Your Flutter CMS will use this URL to upload the image directly to Cloudflare R2.

```go
import (
    "github.com/aws/aws-sdk-go-v2/aws"
    "github.com/aws/aws-sdk-go-v2/config"
    "github.com/aws/aws-sdk-go-v2/service/s3"
)

// Inside your initialization code:
cfg, err := config.LoadDefaultConfig(ctx,
    config.WithRegion("auto"), // R2 uses 'auto'
    config.WithEndpointResolverWithOptions(aws.EndpointResolverWithOptionsFunc(
        func(service, region string, options ...interface{}) (aws.Endpoint, error) {
            return aws.Endpoint{URL: "https://<account_id>.r2.cloudflarestorage.com"}, nil
        })),
)

client := s3.NewFromConfig(cfg)
presignClient := s3.NewPresignClient(client)

// Generate the URL:
presignedReq, err := presignClient.PresignPutObject(ctx, &s3.PutObjectInput{
    Bucket: aws.String("portfolio-assets"),
    Key:    aws.String("image-123.jpg"),
}, s3.WithPresignExpires(15 * time.Minute))

// Return presignedReq.URL to your Flutter client
```

## Next Steps

Now that the backend and storage are complete, we need an interface to actually upload this data and manage our content.

Proceed to [Tutorial 6: The Flutter CMS App](./06-the-flutter-cms-app.md).
