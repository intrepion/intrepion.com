# Tutorial 3: The Go ConnectRPC Backend

In this tutorial, we will set up the Go backend using ConnectRPC. ConnectRPC is a lightweight framework that allows you to build APIs using Protocol Buffers, but exposes them as standard HTTP/JSON or gRPC endpoints.

## Step 1: Initialize the Go Module

Navigate to the `/api` directory and initialize your Go module:

```bash
cd api
go mod init github.com/yourusername/portfolio-cms/api
```

## Step 2: Install ConnectRPC

Install the necessary dependencies for ConnectRPC and standard routing:

```bash
go get connectrpc.com/connect
go get golang.org/x/net/http2
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

Create `cmd/server/main.go` and implement the Connect service:

```go
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"

	"connectrpc.com/connect"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"

	portfoliov1 "github.com/yourusername/portfolio-cms/api/gen/portfolio/v1"
	"github.com/yourusername/portfolio-cms/api/gen/portfolio/v1/portfoliov1connect"
)

type PortfolioServer struct{}

func (s *PortfolioServer) GetProjects(
	ctx context.Context,
	req *connect.Request[portfoliov1.GetProjectsRequest],
) (*connect.Response[portfoliov1.GetProjectsResponse], error) {
	// For now, return static data. In the next tutorial, we'll connect Neon DB.
	res := connect.NewResponse(&portfoliov1.GetProjectsResponse{
		Projects: []*portfoliov1.Project{
			{Id: "1", Title: "First Project", Description: "A great project."},
		},
	})
	return res, nil
}

func main() {
	mux := http.NewServeMux()
	path, handler := portfoliov1connect.NewPortfolioServiceHandler(&PortfolioServer{})
	mux.Handle(path, handler)

	fmt.Println("Starting server on :8080")
	// Use h2c so we can serve HTTP/2 without TLS for local development
	err := http.ListenAndServe(
		":8080",
		h2c.NewHandler(mux, &http2.Server{}),
	)
	log.Fatalf("Server failed: %v", err)
}
```

## Step 5: Hosting on GCP Cloud Run

When deploying to Google Cloud Run, it will automatically handle HTTPS for you. You simply package this Go app into a Docker container and push it to Artifact Registry.

## Next Steps

Now that we have a running API, let's persist our data using a real database.

Proceed to [Tutorial 4: Database Integration (Neon Postgres)](./04-database-integration-neon-postgres.md).
