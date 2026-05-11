# Tutorial 5: The Flutter CMS Client

In this tutorial, we build the internal Content Management System (CMS) client using Flutter. Flutter allows us to compile to the Web right now, and to desktop/mobile later if needed.

## Step 1: Initialize Flutter

From the root of your project, initialize the Flutter web project. Flutter's `create` command will generate the directory for us:

```bash
flutter create client --platforms web,macos,windows
cd client
```

## Step 2: Add Dependencies

You will need packages to make HTTP requests and handle ConnectRPC.

Add them using `flutter pub`:

```bash
flutter pub add connectrpc
flutter pub add http
```

*(Note: Ensure you generate the Dart protobuf files just like you did for Go so you can interact with your ConnectRPC backend).*

## Step 3: Connect to the API

Create a service in Flutter to talk to your Go backend:

```dart
import 'package:connectrpc/connect.dart';
import 'package:http/http.dart' as http;
// Import your generated code
import 'gen/application/v1/application.pb.dart';
import 'gen/application/v1/application.connect.dart';

final transport = Transport(
  baseUrl: 'https://api.yourdomain.com',
  httpClient: http.Client(),
);

final client = ApplicationServiceClient(transport);

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
1. The user selects an image in the Flutter UI.
2. Flutter requests a Presigned Upload URL from the Go API.
3. Flutter makes a direct HTTP `PUT` request to that R2 URL with the image bytes.
4. Once successful, Flutter sends the final project details (Title, Description, and the resulting CDN image URL) to the Go API to save in Postgres.

## Step 5: Update the Justfile

Append the run command to your root `justfile` so you can launch the client easily:

```just
# Run the Flutter CMS client
dev-client:
    cd client && flutter run -d chrome
```

## Step 6: Deployment

Since the CMS is for internal use, you can deploy the compiled Flutter web client to Cloudflare Pages alongside your Astro site, perhaps on a subdomain like `admin.yourdomain.com`.

```bash
flutter build web
# Upload the build/web directory to Cloudflare Pages
```

## Next Steps

Now that we can manage our content, we need to build the public-facing site that users will actually see.

Proceed to [Tutorial 6: The Astro Marketing Site](./06-the-astro-marketing-site.md).
