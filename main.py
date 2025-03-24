import asyncio
from aiohttp import web
import logging
import webbrowser
from app.agent.manus import Manus
from app.logger import logger

logging.basicConfig(level=logging.INFO)
agent = Manus()

async def serve_index(request):
    with open("gui/index.html", "r") as f:
        return web.Response(text=f.read(), content_type="text/html")

async def serve_js(request):
    with open("gui/script.js", "r") as f:
        return web.Response(text=f.read(), content_type="application/javascript")

async def serve_css(request):
    with open("gui/styles.css", "r") as f:
        return web.Response(text=f.read(), content_type="text/css")

async def websocket_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    agent.set_websocket(ws)  # Set WebSocket in the agent

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

                try:
                    logger.warning(f"Processing in progress for task ID: {task_id}")
                    await agent.send_update(f"🎯 Received task {task_id}: {prompt}")
                    await agent.run(prompt)  # Process the task asynchronously
                    await agent.send_update("🚀 Task completed.")

                except Exception as e:
                    logger.error(f"Error processing prompt: {e}")
                    await ws.send_json({
                        "type": "error",
                        "message": f"An error occurred: {str(e)}"
                    })

        elif msg.type == web.WSMsgType.ERROR:
            logger.error(f"WebSocket connection closed with exception: {ws.exception()}")

    return ws

app = web.Application()
app.router.add_get("/", serve_index)
app.router.add_get("/ws", websocket_handler)
app.router.add_get("/gui/script.js", serve_js)
app.router.add_get("/gui/styles.css", serve_css)

async def start_server():
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "localhost", 8080)
    await site.start()
    logger.info("Server started at http://localhost:8080")
    webbrowser.open("http://localhost:8080")
    await asyncio.Event().wait()

if __name__ == "__main__":
    asyncio.run(start_server())
