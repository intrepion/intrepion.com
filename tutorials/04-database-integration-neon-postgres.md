# Tutorial 4: Database Integration (Neon Postgres)

Neon provides a fully managed, serverless Postgres database. It's perfect for our use case because it scales to zero when not in use and is incredibly fast to start up.

## Step 1: Create a Neon Database

1. Go to [neon.tech](https://neon.tech/) and create an account.
2. Create a new project.
3. Once created, copy the connection string (it usually looks like `postgresql://user:password@endpoint.neon.tech/dbname?sslmode=require`).

## Step 2: Install Go Database Drivers

In your `/api` directory, install the necessary Postgres drivers. We recommend `pgx` for Postgres in Go:

```bash
cd api
go get github.com/jackc/pgx/v5
```

## Step 3: Set Up the Database Connection

Update your `cmd/server/main.go` to include the database connection:

```go
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
	// ... other imports ...
)

func main() {
	ctx := context.Background()
	
	// Get the connection string from environment variables
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL environment variable is required")
	}

	// Create a connection pool
	dbpool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Unable to create connection pool: %v\n", err)
		os.Exit(1)
	}
	defer dbpool.Close()

	// Pass dbpool to your server struct
	// server := &PortfolioServer{db: dbpool}
    // ... start http server ...
}
```

## Step 4: Create the Tables

You can create tables manually in the Neon SQL editor, or use a migration tool like `golang-migrate`. For a simple start, here is the SQL:

```sql
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

## Step 5: Querying Data

Update your `GetProjects` method to query Postgres:

```go
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
```

## Next Steps

With data persisted, the next challenge is handling rich media (images/videos) efficiently.

Proceed to [Tutorial 5: Cloudflare R2 Storage Integration](./05-cloudflare-r2-storage-integration.md).
