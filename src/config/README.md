# Configuration

`officeMode.ts` controls the gateway URL and scene dispatch mode through Vite
environment variables. The data API derives an origin from the same URL and
falls back to `http://localhost:8765` for malformed development values.
