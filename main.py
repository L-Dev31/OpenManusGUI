import asyncio
from aiohttp import web
import logging
import webbrowser
from app.agent.manus import Manus
from app.logger import logger

# Configuration du logging
logging.basicConfig(level=logging.INFO)

# Initialisation de l'agent
agent = Manus()

# Fonction pour servir index.html
async def serve_index(request):
    with open("index.html", "r") as f:
        return web.Response(text=f.read(), content_type="text/html")

# Gestion des connexions WebSocket
async def websocket_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    async for msg in ws:
        if msg.type == web.WSMsgType.TEXT:
            data = msg.json()

            if data.get("type") == "prompt":
                prompt = data.get("prompt", "").strip()
                task_id = data.get("taskId")

                if not prompt:
                    await ws.send_json({
                        "type": "error",
                        "message": "Empty prompt provided."
                    })
                    continue

                # Log de début de traitement
                await ws.send_json({
                    "type": "log",
                    "message": "Processing your request...",
                    "level": "warning"
                })

                try:
                    # Traitement de la requête par l'agent
                    result = await agent.run(prompt)

                    # Log de fin de traitement
                    await ws.send_json({
                        "type": "log",
                        "message": "Request processing completed.",
                        "level": "success"
                    })

                    # Envoi de la réponse
                    await ws.send_json({
                        "type": "response",
                        "message": f"Task completed. Result: {result}"
                    })

                except Exception as e:
                    logger.error(f"Error processing prompt: {e}")
                    await ws.send_json({
                        "type": "error",
                        "message": f"An error occurred: {str(e)}"
                    })

        elif msg.type == web.WSMsgType.ERROR:
            logger.error(f"WebSocket connection closed with exception: {ws.exception()}")

    return ws

# Configuration de l'application web
app = web.Application()
app.router.add_get("/", serve_index)
app.router.add_get("/ws", websocket_handler)

# Lancement du serveur
async def start_server():
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "localhost", 8080)
    await site.start()
    logger.info("Server started at http://localhost:8080")

    # Ouvrir le navigateur automatiquement
    webbrowser.open("http://localhost:8080")

    # Garder le serveur en vie
    await asyncio.Event().wait()

if __name__ == "__main__":
    asyncio.run(start_server())
