import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5000",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("error", (error, request, response) => {
            if (response.headersSent) {
              return;
            }

            response.writeHead(502, {
              "Content-Type": "application/json",
            });
            response.end(
              JSON.stringify({
                success: false,
                message:
                  "Could not reach the Flask backend on port 5000. Start it in another terminal with: cd server && start.bat",
              })
            );
          });
        },
      },
    },
  },
});
