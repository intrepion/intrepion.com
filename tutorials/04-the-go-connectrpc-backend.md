# Tutorial 4: The Go ConnectRPC Backend

In this tutorial, we will set up the Go backend using ConnectRPC. ConnectRPC is a lightweight framework that allows you to build APIs using Protocol Buffers, exposing them as standard HTTP/JSON or gRPC endpoints.

## Step 1: Initialize the Go Module

From the root of your project, create the `api` directory and initialize your Go module:

```bash
mkdir api
cd api
go mod init github.com/yourusername/portfolio-cms/api
```

## Step 2: Install Dependencies

Install the necessary dependencies for ConnectRPC, standard routing, Postgres (`pgx`), and the AWS SDK (for R2):

```bash
go get connectrpc.com/connect
go get golang.org/x/net/http2
go get github.com/jackc/pgx/v5
go get github.com/aws/aws-sdk-go-v2
go get github.com/aws/aws-sdk-go-v2/config
go get github.com/aws/aws-sdk-go-v2/service/s3
```

*(Note: You will also need `buf` installed on your system to generate the code from your Protobuf files).*

## Step 3: Define Your Protobuf Service

Create a directory for your protocol buffers (e.g., `proto/portfolio/v1/portfolio.proto`):

```protobuf
syntax = "proto3";

package portfolio.v1;

option go_package = "github.com/yourusername/portfolio-cms/api/gen/portfolio/v1";

message GetProjectsRequest {}

message Project {
  string id = 1;
  string title = 2;
  string description = 3;
  string image_url = 4;
}

message GetProjectsResponse {
  repeated Project projects = 1;
}

service PortfolioService {
  rpc GetProjects(GetProjectsRequest) returns (GetProjectsResponse) {}
}
```

Run `buf generate` to generate the Go code and Connect handlers.

## Step 4: Implement the Server

Create `cmd/server/main.go` and wire up your handlers, database, and R2 presigned URL generation:

```go
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"

	"connectrpc.com/connect"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
	"github.com/jackc/pgx/v5/pgxpool"

	portfoliov1 "github.com/yourusername/portfolio-cms/api/gen/portfolio/v1"
	"github.com/yourusername/portfolio-cms/api/gen/portfolio/v1/portfoliov1connect"
)

type PortfolioServer struct{
	db *pgxpool.Pool
}

func (s *PortfolioServer) GetProjects(ctx context.Context, req *connect.Request[portfoliov1.GetProjectsRequest]) (*connect.Response[portfoliov1.GetProjectsResponse], error) {
	rows, err := s.db.Query(ctx, "SELECT id, title, description, image_url FROM projects")
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	defer rows.Close()

	var projects []*portfoliov1.Project
	for rows.Next() {
		var p portfoliov1.Project
		if err := rows.Scan(&p.Id, &p.Title, &p.Description, &p.ImageUrl); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		projects = append(projects, &p)
	}

	return connect.NewResponse(&portfoliov1.GetProjectsResponse{
		Projects: projects,
	}), nil
}

func main() {
	ctx := context.Background()
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL environment variable is required")
	}

	dbpool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		log.Fatalf("Unable to create connection pool: %v\n", err)
	}
	defer dbpool.Close()

	mux := http.NewServeMux()
	path, handler := portfoliov1connect.NewPortfolioServiceHandler(&PortfolioServer{db: dbpool})
	mux.Handle(path, handler)

	fmt.Println("Starting server on :8080")
	err = http.ListenAndServe(
		":8080",
		h2c.NewHandler(mux, &http2.Server{}),
	)
	log.Fatalf("Server failed: %v", err)
}
```

*(You will also implement your R2 Presigned URL logic here so the Flutter CMS can upload files directly to Cloudflare).*

## Step 5: Update the Justfile

Now that the API exists, append a command to your root `justfile` to run it:

```just
# Run the Go ConnectRPC backend
dev-api:
    cd api && go run cmd/server/main.go
```

## Step 6: Hosting on GCP Cloud Run

When deploying to Google Cloud Run, it will automatically handle HTTPS for you. You simply package this Go app into a Docker container and push it to Artifact Registry. Ensure you pass the `DATABASE_URL` as an environment variable to the container.

## Next Steps

With the backend functioning, it's time to build the admin interface to manage our projects.

Proceed to [Tutorial 5: The Flutter CMS Client](./05-the-flutter-cms-client.md).
