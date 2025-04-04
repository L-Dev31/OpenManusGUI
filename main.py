import asyncio
import os
import sys
import threading
import http.server
import socketserver
import webbrowser
import json
import websockets
from pathlib import Path

from app.agent.manus import Manus
from app.logger import logger

BASE_DIR = Path(__file__).parent
GUI_DIR = BASE_DIR / "gui"
GUI_DIR.mkdir(exist_ok=True)

class WebSocketServer:
    def __init__(self):
        self.agent = None
        self.clients = set()
        self.lock = asyncio.Lock()

    async def register(self, websocket):
        async with self.lock:
            self.clients.add(websocket)

    async def unregister(self, websocket):
        async with self.lock:
            self.clients.remove(websocket)

    async def send_to_all(self, message):
        if not self.clients:
            return
        await asyncio.gather(*[client.send(message) for client in self.clients])

    async def handler(self, websocket):
        await self.register(websocket)
        try:
            # Send initial connection confirmation
            await websocket.send(json.dumps({
                "type": "connection",
                "status": "connected",
                "content": "Connected to OpenManus"
            }))

            async for message in websocket:
                try:
                    data = json.loads(message)
                    if data["type"] == "message":
                        prompt = data["content"]
                        if not prompt.strip():
                            await websocket.send(json.dumps({
                                "type": "error",
                                "content": "Empty prompt provided."
                            }))
                            continue

                        await websocket.send(json.dumps({
                            "type": "status",
                            "content": "Processing your request"
                        }))

                        if not self.agent:
                            self.agent = Manus()

                        try:
                            response = await self.agent.run(prompt)
                            await websocket.send(json.dumps({
                                "type": "response",
                                "content": response if response else "Request processed successfully."
                            }))
                        except Exception as e:
                            logger.error(f"Error processing request: {str(e)}")
                            await websocket.send(json.dumps({
                                "type": "error",
                                "content": f"Error processing request: {str(e)}"
                            }))
                    elif data["type"] == "config":
                        # Handle configuration requests
                        if "action" in data and data["action"] == "get":
                            # Send current configuration
                            config_path = BASE_DIR / "config/config.toml"
                            if config_path.exists():
                                config_content = config_path.read_text(encoding="utf-8")
                                await websocket.send(json.dumps({
                                    "type": "config",
                                    "content": config_content
                                }))
                            else:
                                await websocket.send(json.dumps({
                                    "type": "error",
                                    "content": "Configuration file not found."
                                }))
                        elif "action" in data and data["action"] == "save" and "content" in data:
                            # Save configuration
                            config_path = BASE_DIR / "config.toml"
                            try:
                                with open(config_path, "w", encoding="utf-8") as f:
                                    f.write(data["content"])
                                await websocket.send(json.dumps({
                                    "type": "success",
                                    "content": "Configuration saved successfully."
                                }))
                            except Exception as e:
                                logger.error(f"Error saving configuration: {str(e)}")
                                await websocket.send(json.dumps({
                                    "type": "error",
                                    "content": f"Error saving configuration: {str(e)}"
                                }))
                except json.JSONDecodeError:
                    await websocket.send(json.dumps({
                        "type": "error",
                        "content": "Invalid JSON message."
                    }))
        except websockets.exceptions.ConnectionClosed:
            logger.info("WebSocket connection closed")
        finally:
            await self.unregister(websocket)
            if not self.clients and self.agent:
                await self.agent.cleanup()
                self.agent = None

def start_web_server():
    PORT = 8080

    class ArgonHandler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=BASE_DIR, **kwargs)

        def log_message(self, format, *args):
            pass

    try:
        with socketserver.TCPServer(("", PORT), ArgonHandler) as httpd:
            logger.info(f"Argon interface available at http://localhost:{PORT}/gui/")
            webbrowser.open(f"http://localhost:{PORT}/gui/")
            httpd.serve_forever()
    except OSError as e:
        logger.error(f"Error starting web server: {e}")

async def start_websocket_server():
    ws_server = WebSocketServer()
    async with websockets.serve(ws_server.handler, "localhost", 8081):
        logger.info("WebSocket server started on port 8081")
        await asyncio.Future()

async def main():
    web_thread = threading.Thread(target=start_web_server, daemon=True)
    web_thread.start()

    await start_websocket_server()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Server shutdown requested")
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
