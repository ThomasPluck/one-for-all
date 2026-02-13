import * as http from "http";
import * as fs from "fs";

let server: http.Server | null = null;

export function startGdsServer(gdsPath: string): Promise<number> {
  // Stop any existing server first
  stopGdsServer();

  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      // Handle CORS preflight
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "*");
        res.writeHead(204);
        res.end();
        return;
      }

      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Content-Type", "application/octet-stream");

      if (!fs.existsSync(gdsPath)) {
        res.writeHead(404);
        res.end("File not found");
        return;
      }

      fs.createReadStream(gdsPath).pipe(res);
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server!.address() as { port: number };
      resolve(addr.port);
    });
  });
}

export function stopGdsServer(): void {
  if (server) {
    server.close();
    server = null;
  }
}
