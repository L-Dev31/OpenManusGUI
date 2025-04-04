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
import toml

from app.agent.manus import Manus
from app.logger import logger

BASE_DIR = Path(__file__).parent
GUI_DIR = BASE_DIR / "gui"
GUI_DIR.mkdir(exist_ok=True)
CONFIG_PATH = BASE_DIR / "config" / "config.toml"

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

    async def get_current_config(self):
        """Charge la configuration actuelle sans fallback"""
        if not CONFIG_PATH.exists():
            raise FileNotFoundError(f"Le fichier de configuration {CONFIG_PATH} n'existe pas")

        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return toml.load(f)

    async def save_config(self, config_data):
        """Sauvegarde la configuration sans validation automatique"""
        try:
            toml.dumps(config_data)

            with open(CONFIG_PATH, "w", encoding="utf-8") as f:
                toml.dump(config_data, f)
        except Exception as e:
            raise ValueError(f"Configuration TOML invalide: {str(e)}")

    async def handler(self, websocket):
        await self.register(websocket)
        try:
            # Message de connexion initial
            await websocket.send(json.dumps({
                "type": "connection",
                "status": "connected",
                "content": "Connecté à OpenManus"
            }))

            async for message in websocket:
                try:
                    data = json.loads(message)

                    if data["type"] == "message":
                        # Gestion des messages (inchangé)
                        prompt = data["content"]
                        if not prompt.strip():
                            await websocket.send(json.dumps({
                                "type": "error",
                                "content": "Prompt vide fourni."
                            }))
                            continue

                        await websocket.send(json.dumps({
                            "type": "status",
                            "content": "Traitement de votre requête"
                        }))

                        if not self.agent:
                            self.agent = Manus()

                        try:
                            response = await self.agent.run(prompt)
                            await websocket.send(json.dumps({
                                "type": "response",
                                "content": response if response else "Requête traitée avec succès."
                            }))
                        except Exception as e:
                            logger.error(f"Erreur de traitement: {str(e)}")
                            await websocket.send(json.dumps({
                                "type": "error",
                                "content": f"Erreur de traitement: {str(e)}"
                            }))

                    elif data["type"] == "config":
                        # Gestion de la configuration
                        if "action" in data and data["action"] == "get":
                            try:
                                config_data = await self.get_current_config()
                                await websocket.send(json.dumps({
                                    "type": "config",
                                    "content": config_data
                                }))
                            except Exception as e:
                                await websocket.send(json.dumps({
                                    "type": "error",
                                    "content": f"Erreur de lecture: {str(e)}"
                                }))

                        elif "action" in data and data["action"] == "save":
                            if "content" not in data:
                                await websocket.send(json.dumps({
                                    "type": "error",
                                    "content": "Aucune configuration fournie."
                                }))
                                continue

                            try:
                                await self.save_config(data["content"])
                                await websocket.send(json.dumps({
                                    "type": "success",
                                    "content": "Configuration sauvegardée."
                                }))
                            except Exception as e:
                                await websocket.send(json.dumps({
                                    "type": "error",
                                    "content": f"Erreur de sauvegarde: {str(e)}"
                                }))

                except json.JSONDecodeError:
                    await websocket.send(json.dumps({
                        "type": "error",
                        "content": "Message JSON invalide."
                    }))

        except websockets.exceptions.ConnectionClosed:
            logger.info("Connexion WebSocket fermée")
        finally:
            await self.unregister(websocket)
            if not self.clients and self.agent:
                await self.agent.cleanup()
                self.agent = None

def start_web_server():
    PORT = 8080

    class ArgonHandler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=GUI_DIR, **kwargs)

        def log_message(self, format, *args):
            pass

    try:
        with socketserver.TCPServer(("", PORT), ArgonHandler) as httpd:
            logger.info(f"Interface disponible sur http://localhost:{PORT}/")
            webbrowser.open(f"http://localhost:{PORT}/")
            httpd.serve_forever()
    except OSError as e:
        logger.error(f"Erreur du serveur web: {e}")

async def start_websocket_server():
    ws_server = WebSocketServer()
    async with websockets.serve(ws_server.handler, "localhost", 8081):
        logger.info("Serveur WebSocket démarré sur le port 8081")
        await asyncio.Future()

async def main():
    web_thread = threading.Thread(target=start_web_server, daemon=True)
    web_thread.start()

    await start_websocket_server()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Arrêt demandé")
    except Exception as e:
        logger.error(f"Erreur inattendue: {e}")
