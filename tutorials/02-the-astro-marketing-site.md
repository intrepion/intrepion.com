# Tutorial 2: The Astro Marketing Site

Astro is a fantastic framework for building content-rich websites. By default, it generates static HTML, which means perfect SEO and blazing fast load times.

## Step 1: Initialize Astro

Navigate to your `/marketing` directory and create a new Astro project:

```bash
cd marketing
npm create astro@latest ./
```

During the setup, choose the "Empty" or "Blog" template depending on your preference. Install dependencies when prompted.

## Step 2: Configure for Static Site Generation (SSG)

By default, Astro uses Static Site Generation. This means when you run the build command, it fetches any necessary data and generates plain HTML/CSS files. 

Ensure your `astro.config.mjs` is set to `static` (which is the default).

```javascript
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  output: 'static',
});
```

## Step 3: Structuring Your Pages

Astro uses file-based routing. Inside the `src/pages/` directory, create your main portfolio views:

- `index.astro` (Home)
- `portfolio.astro` (Gallery/Projects)
- `about.astro` (About Me)

## Step 4: Fetching Data at Build Time

To avoid hitting your Go backend dynamically when a user visits your site (saving on GCP egress costs), Astro can fetch data from your Go API or Neon DB during the build process.

Inside `src/pages/portfolio.astro`:

```astro
---
// This runs DURING THE BUILD, not in the browser!
const response = await fetch('https://api.yourdomain.com/portfolio-items');
const projects = await response.json();
---

<html>
  <body>
    <h1>My Portfolio</h1>
    <ul>
      {projects.map((project) => (
        <li>
          <h2>{project.title}</h2>
          <img src={project.imageUrl} alt={project.title} />
        </li>
      ))}
    </ul>
  </body>
</html>
```

## Next Steps

Your marketing site is ready to be styled and deployed (e.g., to Cloudflare Pages or Vercel). Next, we will set up the backend that serves the data.

Proceed to [Tutorial 3: The Go ConnectRPC Backend](./03-the-go-connectrpc-backend.md).
