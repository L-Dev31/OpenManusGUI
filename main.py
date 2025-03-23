import asyncio
from aiohttp import web
import logging
import webbrowser
from app.agent.manus import Manus
from app.logger import logger

# Configure logging
logging.basicConfig(level=logging.INFO)
agent = Manus()

async def serve_index(request):
    """Serve the dashboard (index.html)"""
    with open("index.html", "r") as f:
        return web.Response(text=f.read(), content_type="text/html")

async def websocket_handler(request):
    """WebSocket handler for real-time communication"""
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

                try:
                    # Run the agent with the prompt
                    await agent.run(prompt)

                    # Get the formatted thoughts from the agent
                    final_response = agent.get_thought_content()

                    # Send the final response
                    await ws.send_json({
                        "type": "response",
                        "message": final_response
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

# Define the web application
app = web.Application()
app.router.add_get("/", serve_index)
app.router.add_get("/ws", websocket_handler)

async def start_server():
    """Start the server and open the browser"""
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "localhost", 8080)
    await site.start()
    logger.info("Server started at http://localhost:8080")
    webbrowser.open("http://localhost:8080")
    await asyncio.Event().wait()

if __name__ == "__main__":
    asyncio.run(start_server())
