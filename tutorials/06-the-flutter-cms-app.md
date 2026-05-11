# Tutorial 6: The Flutter CMS App

In this final tutorial, we build the internal Content Management System (CMS) using Flutter. Flutter is chosen because it allows easy compilation to the Web now, and to desktop/mobile later if needed.

## Step 1: Initialize Flutter

Navigate to the `/client` directory and initialize Flutter:

```bash
cd client
flutter create . --platforms web,macos,windows
```

## Step 2: Add Dependencies

You will need packages to make HTTP requests and handle ConnectRPC (or standard JSON if you aren't using gRPC-web yet). Fortunately, ConnectRPC has a Dart package!

Add them to your `pubspec.yaml`:

```bash
flutter pub add connectrpc
flutter pub add http
```

*(Note: Ensure you generate the Dart protobuf files just like you did for Go).*

## Step 3: Connect to the API

Create a service in Flutter to talk to your Go backend:

```dart
import 'package:connectrpc/connect.dart';
import 'package:http/http.dart' as http;
// Import your generated code
import 'gen/portfolio/v1/portfolio.pb.dart';
import 'gen/portfolio/v1/portfolio.connect.dart';

final transport = Transport(
  baseUrl: 'https://api.yourdomain.com',
  httpClient: http.Client(),
);

final client = PortfolioServiceClient(transport);

Future<void> fetchProjects() async {
  final request = GetProjectsRequest();
  final response = await client.getProjects(request);
  
  for (var project in response.projects) {
    print(project.title);
  }
}
```

## Step 4: Building the Upload Flow

When adding a new project via the CMS:
1. User selects an image in the Flutter UI.
2. Flutter requests a Presigned Upload URL from the Go API (Tutorial 5).
3. Flutter makes a direct HTTP `PUT` request to that R2 URL with the image bytes.
4. Once successful, Flutter sends the final project details (Title, Description, and the resulting CDN image URL) to the Go API to save in Postgres (Tutorial 4).

## Step 5: Deployment

Since the CMS is for internal use, you can deploy the compiled Flutter web app to Cloudflare Pages alongside your Astro site, perhaps on a subdomain like `admin.yourdomain.com`.

```bash
flutter build web
# Upload the build/web directory to Cloudflare Pages
```

## Conclusion

You now have a fully functioning, highly scalable architecture!
- **Marketing Site (Astro):** Perfect SEO, zero runtime backend cost.
- **Backend (Go + ConnectRPC):** Strongly typed, running efficiently on GCP.
- **Database & Storage (Neon + R2):** Fast, scalable, and extremely cheap.
- **CMS (Flutter):** A robust tool to manage your data, ready to become a native desktop or mobile app in the future.
