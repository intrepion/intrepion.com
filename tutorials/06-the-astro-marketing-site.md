# Tutorial 6: The Astro Marketing Site

Astro is a fantastic framework for building content-rich websites. By default, it generates static HTML, which means perfect SEO and blazing fast load times.

## Step 1: Initialize Astro

From the root of your project, run the Astro initialization command, which will create the `marketing` directory for you:

```bash
npm create astro@latest marketing
cd marketing
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

Astro uses file-based routing. Inside the `src/pages/` directory, create your main application views:

- `index.astro` (Home)
- `projects.astro` (Products/Projects/Services/Features - *Note: might be duplicated in Flutter for logged-in experience*)
- `blog/index.astro` (Blog)
- `about.astro` (About)
- `faq.astro` (FAQ)
- `testimonials.astro` (Testimonials)
- `contact.astro` (Contact)
- `press-kit.astro` (Press Kit)
- `privacy-policy.astro` (Privacy Policy)
- `terms-and-conditions.astro` (Terms and Conditions)
- `accessibility-statement.astro` (Accessibility Statement)
- `returns-and-refunds.astro` (Returns and Refunds)
- `shipping-information.astro` (Shipping Information)
- `sitemap.xml.ts` (Sitemap)
- `robots.txt.ts` (Robots.txt)
- `404.astro` (Page Not Found)

## Step 4: Fetching Data at Build Time

To avoid hitting your Go backend dynamically when a user visits your site (saving on GCP egress costs), Astro can fetch data from your Go API (or directly from Neon DB) during the build process.

Inside `src/pages/projects.astro`:

```astro
---
// This runs DURING THE BUILD, not in the browser!
const response = await fetch('https://api.yourdomain.com/application-items');
const projects = await response.json();
---

<html>
  <body>
    <h1>My Projects</h1>
    <ul>
      {projects.map((project) => (
        <li>
          <h2>{project.title}</h2>
          <!-- These URLs come from Cloudflare R2 -->
          <img src={project.imageUrl} alt={project.title} />
        </li>
      ))}
    </ul>
  </body>
</html>
```

## Step 5: Update the Justfile

Append the run command to your root `justfile`:

```just
# Run the Astro marketing site
dev-marketing:
    cd marketing && npm run dev
```

## Step 6: Deployment

Your marketing site is ready to be styled and deployed to Cloudflare Pages (or Vercel). Cloudflare Pages connects directly to your GitHub repo and can automatically rebuild the site whenever you update your code.

## Conclusion

You now have a fully functioning, highly scalable architecture!
- **Marketing Site (Astro):** Perfect SEO, zero runtime backend cost.
- **Backend (Go + ConnectRPC):** Strongly typed, running efficiently on GCP.
- **Database & Storage (Neon + R2):** Fast, scalable, and extremely cheap.
- **CMS (Flutter):** A robust tool to manage your data natively across web, desktop, and mobile.
