# SchemaExtract

SchemaExtract is a two-part application for extracting and presenting database schema metadata.

## Project structure

### `web`

The web application provides the user interface and request workflow. It collects extraction parameters, calls the backend service, and presents the returned schema information.

### `cf-service`

The Cloudflare Worker contains the backend extraction logic. It receives requests from the web application, connects to the configured source, reads its metadata, and returns the extracted schema.

## Request flow

```text
User → web → cf-service → source database
			   ↓
		   schema result
```

1. A user starts an extraction from the web application.
2. The web application sends the request to `cf-service`.
3. The service connects to the selected source and extracts its schema metadata.
4. The service returns the result or an error response.
5. The web application displays the extracted schema.

## Running locally

Run the web application and `cf-service` from their respective project directories using the commands documented by each project. Configure the web application with the service base URL, and configure `cf-service` with the source connection settings required by the extraction request.

## Cloudflare deployment

From the `cf-service` directory, run `npx wrangler deploy` to deploy the Worker to Cloudflare. Configure the web application to use the deployed Worker URL. Keep credentials, tokens, and connection strings out of the repository.

## Operational guidance

- Keep the web and service endpoint configuration aligned across environments.
- Validate extraction input before sending it to the service.
- Protect extraction endpoints with the project's authentication and authorization controls.
- Log failures without exposing credentials or other sensitive connection details.
