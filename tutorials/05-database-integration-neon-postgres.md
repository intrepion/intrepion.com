# Tutorial 5: Database Integration (Neon Postgres)

Neon provides a fully managed, serverless Postgres database. It's perfect for our use case because it scales to zero when not in use and is incredibly fast to start up.

## Step 1: Create a Neon Database

1. Go to [neon.tech](https://neon.tech/) and create an account.
2. Create a new project.
3. Once created, copy the connection string (it usually looks like `postgresql://user:password@endpoint.neon.tech/dbname?sslmode=require`).

Keep this connection string handy as we will provide it to the Go backend via environment variables.

## Step 2: Define the Schema

You can create tables manually in the Neon SQL editor, or use a migration tool later. For a simple start, run the following SQL in the Neon console to create our projects table:

```sql
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

## Next Steps

Now that we have both our CDN for files and our Database for structured data, it's time to build the API that connects them.

Proceed to [Tutorial 6: The Go ConnectRPC Backend](./06-the-go-connectrpc-backend.md).
