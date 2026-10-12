import "dotenv/config";
import { createApp } from "./app.js";
import { getNasaApiKey } from "./lib/nasaClient.js";

const port = Number(process.env.PORT) || 8787;
const app = createApp();

app.listen(port, () => {
  const usingDemoKey = getNasaApiKey() === "DEMO_KEY";
  console.log(`Astrolabe API listening on http://localhost:${port}`);
  if (usingDemoKey) {
    console.warn(
      "Using NASA's shared DEMO_KEY (30 req/hr, 50 req/day). Set NASA_API_KEY in server/.env for real use."
    );
  }
});